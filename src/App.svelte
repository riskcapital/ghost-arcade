<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Canvas from './lib/components/Canvas.svelte';
  import WebGPUCanvas from './lib/components/WebGPUCanvas.svelte';
  import AudioInputPicker from './lib/components/AudioInputPicker.svelte';
  import BpmTapWidget from './lib/components/BpmTapWidget.svelte';
  // Feature tour removed at user request — was an interactive multi-step
  // overlay shown on first launch, but disrupted the experience for users
  // already familiar with VJ software. The OnboardingTour.svelte and
  // onboarding store files remain on disk but are no longer mounted.
  import WarpHandles from './lib/components/WarpHandles.svelte';
  import MeshWarpHandles from './lib/components/MeshWarpHandles.svelte';
  import CustomShapeHandles from './lib/components/CustomShapeHandles.svelte';
  import LayerPanel from './lib/components/LayerPanel.svelte';
  import LinesPanel from './lib/components/LinesPanel.svelte';
  import SVGSourceTray from './lib/components/SVGSourceTray.svelte';
  import LightPaintingPanel from './lib/components/LightPaintingPanel.svelte';
  import AdvLightPaintingPanel from './lib/components/AdvLightPaintingPanel.svelte';
  import TextPanel from './lib/components/TextPanel.svelte';
  import SplatPanel from './lib/components/SplatPanel.svelte';
  import Model3DPanel from './lib/components/Model3DPanel.svelte';
  import PixelFXPanel from './lib/components/PixelFXPanel.svelte';
  import GPULayerPanel from './lib/components/GPULayerPanel.svelte';
  import MediaTray from './lib/components/MediaTray.svelte';
  import PluginLayerPanel from './lib/components/PluginLayerPanel.svelte';
  import { preloadShaders } from './lib/shaderPreload';

  // Kick off shader preloading immediately — don't wait for MediaTray to mount
  preloadShaders();
  import MobileApp from './lib/components/MobileApp.svelte';
  import OutputWindow from './lib/components/OutputWindow.svelte';
  import VJModePanel from './lib/components/VJModePanel.svelte';
  import StageDesignerPanel from './lib/components/StageDesignerPanel.svelte';
  import OfflineRenderModal from './lib/components/OfflineRenderModal.svelte';
  import { workspace } from './lib/stores/workspace';
  import PresetTray from './lib/components/PresetTray.svelte';
  import LayerSequencer from './lib/components/LayerSequencer.svelte';
  import KeyframeTimeline from './lib/components/KeyframeTimeline.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import GridOverlay from './lib/components/GridOverlay.svelte';
  import ShortcutsOverlay from './lib/components/ShortcutsOverlay.svelte';
  import ConfirmPopover from './lib/components/ConfirmPopover.svelte';
  import WelcomeModal from './lib/components/WelcomeModal.svelte';
  // EULAModal removed — no EULA in the open-source build.
  import UpdateModal from './lib/components/UpdateModal.svelte';
  import { updateModalOpen } from './lib/stores/uiState';
  import { project, selectedLayer, selectedLayerIds, selectedLinesLayer, selectedLineElement, selectedLightPaintingLayer, selectedAdvLightPaintingLayer, selectedTextLayer, selectedSVGLayer, selectedMediaLayer, selectedSplatLayer, selectedModel3DLayer, selectedPixelFXLayer, selectedGPULayer, selectedGroupLayer, setHistoryCallback } from './lib/stores/layers';
  import { keyframeTimeline } from './lib/stores/keyframeTimeline';
  import { settings, outputFrozen } from './lib/stores/settings';
  import { checkForUpdate, type VersionCheckResult } from './lib/utils/versionCheck';
  import { startRecording as startRec, formatRecordingDuration, type RecorderHandle } from './lib/recording/recorder';
  import { vjClipLauncher } from './lib/stores/vjClipLauncher';
  import { audioStore } from './lib/stores/audio';
  // macros.ts registers a callback with midiRouter on import so
  // `vj:macro:N:value` MIDI messages route into the macro store. Pulled in
  // here to guarantee it runs at app boot, even if the VJ panel hasn't
  // been opened yet. Binding also used by newComposition() to reset.
  import { macros } from './lib/stores/macros';
  import { snapshots } from './lib/stores/snapshots';
  // Aliased import — `snapshots` is also used as a local variable name
  // elsewhere in this file. Aliased *Store import for use inside
  // reactive blocks like syncVJClips.
  import { snapshots as snapshotsStore } from './lib/stores/snapshots';
  import { mediaLibrary } from './lib/stores/media';
  import { history, canUndo, canRedo } from './lib/stores/history';
  import { recentFiles } from './lib/stores/recentFiles';
  import { initLicense, destroyLicense } from './lib/stores/license';
  import { startUpdateChecker, stopUpdateChecker } from './lib/stores/updateChecker';
  import { linesStore } from './lib/stores/lines';
  import { loadShadersFromServer, loadCloudShadersFromDisk, shaderLibrary } from './lib/stores/shaderLibrary';
  import { mediaTrayShaders } from './lib/stores/mediaTrayShaders';
  import { getNativeRendererStatus } from './lib/api/native-renderer';
  import { startSpoutScanner } from './lib/stores/spout';
  import { preloadShaderLibrary, populateShaderListForSync } from './lib/preload';
  import { invoke, isMac, isDesktopApp } from './lib/bridge';
  import type { Point2D, BezierPoint, Layer, WarpCorners } from './lib/types';
  import { generateUUID } from './lib/types';
  import { createDefaultFreehandLine, createDefaultPointClickLine } from './lib/lines/types';
  import QRCode from 'qrcode';
  import { midiManager } from './lib/midi/midiManager';
  import { midiStore } from './lib/midi/midiStore';
  import { synthVisionStore, sessionClipCache, isfShaderCache } from './lib/stores/synthVision';
  import { modulationStore } from './lib/audio/modulation';
  import MidiDeviceSelector from './lib/components/MidiDeviceSelector.svelte';
  import MidiOverlay from './lib/components/MidiOverlay.svelte';
  import LoadingOverlay from './lib/components/LoadingOverlay.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  // Director feature (disabled for this release — coming in a future update)
  // import DirectorPanel from './lib/components/DirectorPanel.svelte';
  // import { directorStore } from './lib/stores/director';
  import { fpsStore } from './lib/stores/fps';

  // Drawing mode for lines layers (connected to LinesPanel)
  let linesDrawingMode: 'none' | 'freehand' | 'pointClick' = 'none';
  let linesDrawingPoints: Point2D[] = [];
  let isLinesDrawing = false;

  // File menu state
  let fileMenuOpen = false;
  let currentFileHandle: any = null; // For Save functionality (remembers last saved location)

  let outputWindow: OutputWindow;
  let outputIsOpen = false;
  let canvasComponent: Canvas;
  // Phase 3.0 bridge: bound when experimental.editorWebGPU is on so
  // we can push the WebGL canvas reference into it after both
  // components mount. See the WebGPUCanvas mount block for the
  // explicit push.
  let webgpuBridgeComponent: WebGPUCanvas | null = null;

  // GPU info state (populated after engine init)
  let gpuInfo: { renderer: string; vendor: string; isIntegrated: boolean } | null = null;
  // Persisted "user has seen the integrated-GPU warning" flag.
  const INTEGRATED_GPU_BANNER_DISMISSED_KEY = 'ga.integratedGpuBannerDismissed';
  let showIntegratedGpuBanner = false;
  function dismissIntegratedGpuBanner(persist: boolean) {
    showIntegratedGpuBanner = false;
    if (persist && typeof window !== 'undefined') {
      try { window.localStorage?.setItem(INTEGRATED_GPU_BANNER_DISMISSED_KEY, '1'); } catch { /* */ }
    }
  }
  async function checkGPU() {
    // First try native D3D11 renderer status (this is the real GPU for shader rendering)
    try {
      const status = await getNativeRendererStatus();
      if (status && status.adapter_name) {
        const name = status.adapter_name;
        const nameLower = name.toLowerCase();
        const discretePatterns = ['nvidia', 'geforce', 'rtx', 'gtx', 'quadro', 'radeon rx', 'radeon pro', 'arc a'];
        const isDiscrete = discretePatterns.some(p => nameLower.includes(p));
        gpuInfo = {
          renderer: name,
          vendor: nameLower.includes('nvidia') ? 'NVIDIA' : nameLower.includes('amd') || nameLower.includes('radeon') ? 'AMD' : nameLower.includes('intel') ? 'Intel' : 'Unknown',
          isIntegrated: !isDiscrete,
        };
        console.log(`[GPU] Native D3D11 renderer on: ${name} (${isDiscrete ? 'discrete' : 'integrated'})`);
        return;
      }
    } catch (_) { /* native renderer not running yet, fall through to WebGL */ }

    // Fallback: read from WebGL engine (this reports WebView2's GPU, often integrated)
    const engine = canvasComponent?.getEngine();
    if (engine) {
      gpuInfo = engine.getGPUInfo();
    }
    // Surface a one-time warning if running on integrated / software
    // graphics. Routes the user to Settings → Performance.
    if (gpuInfo?.isIntegrated && typeof window !== 'undefined') {
      const dismissed = window.localStorage?.getItem(INTEGRATED_GPU_BANNER_DISMISSED_KEY);
      if (!dismissed) showIntegratedGpuBanner = true;
    }
  }
  // Check GPU after a short delay to let native renderer initialize
  $: if (canvasComponent) { setTimeout(checkGPU, 2000); }

  // Output rotation / crop / cursor used to live as local component state
  // here. Moved into $settings.output so they auto-sync to the output window
  // via the existing BroadcastChannel and apply via CSS on the output canvas.
  // SettingsPanel now reads/writes them directly through the settings store.
  let showOutputSettings = false;

  // Audio input picker state moved into AudioInputPicker.svelte component.

  // Mask editing state
  // -- Anchor dragging --
  // Tracks which anchor across which sub-polygon is currently being dragged.
  let draggingMaskAnchor: { shapeIndex: number; pointIndex: number } | null = null;
  // -- Bezier handle dragging --
  // Tracks which cpIn/cpOut handle is being dragged.
  let draggingMaskHandle: { shapeIndex: number; pointIndex: number; which: 'cpIn' | 'cpOut' } | null = null;
  // -- Pen-tool draft --
  // While the user is mid-mousedown on empty canvas we hold the future anchor
  // here and watch for drag distance > DRAG_BEND_THRESHOLD to decide between
  // a sharp corner and a smooth bezier point (Illustrator-style).
  type MaskPenDraft = {
    anchor: Point2D;       // Normalized 0-1 UV
    anchorPx: { x: number; y: number }; // Pixel position of anchor (fixed at mousedown)
    dragPx: { x: number; y: number };   // Current pixel position (tracks during drag)
    isCurve: boolean;      // Set once drag distance exceeds threshold
  };
  let maskPenDraft: MaskPenDraft | null = null;
  const MASK_DRAG_BEND_THRESHOLD = 6; // px

  // -- Pen tool mode for closed shapes --
  // Mirrors the CustomShapeHandles pen toolbar. `edit` is the default
  // (drag anchors, drag handles); `add` lets the user click an edge to
  // insert a knot mid-segment; `remove` lets the user delete an anchor
  // with a left-click (vs. having to right-click). Per-shape Edit button
  // in LayerPanel flips this to `edit` so the toolbar appears even when
  // the user re-enters edit mode after closing all shapes.
  let maskPenMode: 'edit' | 'add' | 'remove' = 'edit';
  // Currently-hovered edge index keyed by shape, for add-mode visual.
  // -1 means "no edge under cursor."
  let maskHoverShapeIdx: number = -1;
  let maskHoverEdgeIdx: number = -1;
  let maskHoverPx: { x: number; y: number } = { x: 0, y: 0 };
  const MASK_EDGE_HIT_THRESHOLD = 10; // px

  let shapeWarpModeEnabled = false;
  let draggingShapeControlPointIndex: number | null = null;
  let shapeWarpOverlayEl: SVGSVGElement;
  let layerShapeControlPoints: Point2D[] = [];

  let viewportEl: HTMLDivElement;
  let viewportWidth = 800;
  let viewportHeight = 600;

  // Computed canvas dimensions (aspect-ratio constrained within viewport)
  // When measured values from Canvas component are available, use those for pixel-perfect alignment
  $: canvasAspect = ($project.width || 1920) / ($project.height || 1080);
  $: viewportAspect = viewportWidth / viewportHeight;
  $: canvasWidth = measuredCanvasWidth ?? (viewportAspect > canvasAspect
    ? viewportHeight * canvasAspect
    : viewportWidth);
  $: canvasHeight = measuredCanvasHeight ?? (viewportAspect > canvasAspect
    ? viewportHeight
    : viewportWidth / canvasAspect);
  // Offset for letterboxing (centering)
  $: canvasOffsetX = measuredCanvasOffsetX ?? (viewportWidth - canvasWidth) / 2;
  $: canvasOffsetY = measuredCanvasOffsetY ?? (viewportHeight - canvasHeight) / 2;

  // Recalculate viewport size when keyframe tray opens/closes.
  // Subscribe directly instead of using $: reactive block, because $keyframeTimeline
  // updates at 60Hz during playback and Svelte re-evaluates every $: block that
  // reads the store — even if we only care about .isOpen.
  {
    let lastOpen: boolean | null = null;
    keyframeTimeline.subscribe(s => {
      if (lastOpen !== null && lastOpen !== s.isOpen) {
        requestAnimationFrame(() => updateViewportSize());
        setTimeout(() => updateViewportSize(), 350);
      }
      lastOpen = s.isOpen;
    });
  }

  // Viewport pan/zoom state
  let viewportZoom = 1;
  let viewportPanX = 0;
  let viewportPanY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;
  let isSpacePressed = false;

  // Light painting draw mode toggle — when off, warp/mesh handles are accessible
  let lpDrawingEnabled = true;

  // Path-edit state shared between the overlay LightPaintingPanel
  // (renders handles into the viewport SVG) and the sidebar
  // LightPaintingPanel (owns the toggle UI). Both instances bind: to
  // these so toggling Edit Path in the sidebar reaches the overlay's
  // {#if isPathEditMode ...} block.
  let lpIsPathEditMode = false;
  let lpPathEditTool: 'move' | 'delete' | 'insert' = 'move';
  let lpPathEditShowAllRawPoints = false;

  // Check if we're on mobile route
  let isMobile = false;

  // First-run welcome modal (EULA gate removed in OSS build)
  let showWelcome = false;
  // Offline render-to-video modal. File menu → "Render to Video…"
  // toggles this; the modal owns its own progress + cancel flow via
  // the offlineRender store.
  let showOfflineRender = false;

  // Keyboard shortcut help overlay
  let showShortcutHelp = false;

  // App version baked in at build time from package.json (see vite.config.ts).
  // Auto-tracks the actual shipped version so the footer pill never
  // drifts from package.json.
  const appVersion: string = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?');
  // Background update check — quietly polls GitHub Releases once on
  // startup (rate-limited to once / 24 h locally) and stores the
  // result. The footer version label turns into a "→ vX.Y.Z available"
  // link when an upgrade exists. Settings panel exposes a manual
  // "Check now" button for users who want to force a fresh check.
  let versionInfo: VersionCheckResult | null = null;
  let versionCheckInFlight = false;
  async function runVersionCheck(force = false) {
    if (versionCheckInFlight) return;
    versionCheckInFlight = true;
    try {
      versionInfo = await checkForUpdate({ force });
    } catch (err) {
      console.warn('[VersionCheck] failed:', err);
    } finally {
      versionCheckInFlight = false;
    }
  }

  // VJ Preset name for saving from mapping mode
  let vjPresetName = '';

  // Unsaved changes tracking - increments on every project change, resets on save
  let lastSavedState: string | null = null;
  let hasUnsavedChanges = false;

  // Close confirmation modal state
  let showCloseModal = false;
  let pendingCloseResolve: (() => void) | null = null;

  // Auto-save & crash recovery state
  let autosaveInterval: ReturnType<typeof setInterval> | null = null;
  let showRecoveryModal = false;
  let recoveryTimestamp = '';

  // Track project changes to detect unsaved state
  $: {
    // Use layer count + selected layer as a lightweight change indicator
    // The actual comparison is done via JSON snapshot
    const currentState = JSON.stringify({
      layers: $project.layers.map(l => ({ id: l.id, name: l.name, type: l.type, opacity: l.opacity, visible: l.visible, corners: l.corners, contentFit: l.contentFit })),
      name: $project.name,
    });
    hasUnsavedChanges = lastSavedState !== null && currentState !== lastSavedState;
  }

  function markAsSaved() {
    const currentState = JSON.stringify({
      layers: get(project).layers.map(l => ({ id: l.id, name: l.name, type: l.type, opacity: l.opacity, visible: l.visible, corners: l.corners, contentFit: l.contentFit })),
      name: get(project).name,
    });
    lastSavedState = currentState;
    hasUnsavedChanges = false;
  }

  // Auto-save cleanup
  onDestroy(() => {
    if (autosaveInterval) {
      clearInterval(autosaveInterval);
      autosaveInterval = null;
    }
    viewportEl?.removeEventListener('wheel', handleViewportWheel);
  });

  // Recovery modal actions
  function recoverAutosave() {
    const savedData = localStorage.getItem('ghostarcade-autosave');
    if (savedData) {
      project.importProjectJSON(savedData);
      markAsSaved();
    }
    localStorage.removeItem('ghostarcade-autosave');
    localStorage.removeItem('ghostarcade-autosave-timestamp');
    showRecoveryModal = false;
  }

  function discardAutosave() {
    localStorage.removeItem('ghostarcade-autosave');
    localStorage.removeItem('ghostarcade-autosave-timestamp');
    showRecoveryModal = false;
  }

  function clearAutosave() {
    localStorage.removeItem('ghostarcade-autosave');
    localStorage.removeItem('ghostarcade-autosave-timestamp');
  }

  // Close modal actions
  async function closeModalSave() {
    showCloseModal = false;
    await saveComposition();
    markAsSaved();
    if (pendingCloseResolve) pendingCloseResolve();
    pendingCloseResolve = null;
    window.close();
  }

  async function closeModalDiscard() {
    showCloseModal = false;
    hasUnsavedChanges = false;
    if (pendingCloseResolve) pendingCloseResolve();
    pendingCloseResolve = null;
    window.close();
  }

  function closeModalCancel() {
    showCloseModal = false;
    if (pendingCloseResolve) pendingCloseResolve();
    pendingCloseResolve = null;
  }

  // Recording state (shared recorder)
  let recorderHandle: RecorderHandle | null = null;
  let isRecording = false;
  let recordingDuration = 0;

  // Settings panel state
  let showSettings = false;
  let mediaSidebarTab: 'media' | 'plugin' = 'media';
  let selectedMediaSource: any = null;
  let selectedPluginId: string | null = null;
  let hasPluginControls = false;

  // Start recording from header (uses shared recorder with audio support)
  function startRecording() {
    recordingDuration = 0;
    recorderHandle = startRec({
      namePrefix: 'Recording',
      onDurationUpdate: (s) => { recordingDuration = s; },
      onComplete: () => { isRecording = false; recorderHandle = null; },
      onError: (err) => { alert('Failed to start recording: ' + err.message); },
    });
    if (recorderHandle) {
      isRecording = true;
    }
  }

  function stopRecording() {
    if (recorderHandle) {
      recorderHandle.stop();
      isRecording = false;
      recorderHandle = null;
    }
  }

  // =========================================================================
  // FREEZE OUTPUT (pause rendering — last frame stays on screen)
  // =========================================================================
  function toggleFreeze() {
    outputFrozen.update(v => {
      const next = !v;
      // Broadcast to output window so it also freezes
      import('./lib/sync/stateBroadcast').then(m => m.broadcastFrozenState(next));
      return next;
    });
  }

  // Mic / system audio toggle + device picker logic moved into
  // AudioInputPicker.svelte (single source of truth for all three modes).

  // =========================================================================
  // SCREENSHOT — capture canvas as PNG, save to recordings folder + media lib
  // =========================================================================
  async function takeScreenshot() {
    try {
      const canvas = document.querySelector('canvas.main-canvas') as HTMLCanvasElement ||
                     document.querySelector('.canvas-container canvas') as HTMLCanvasElement ||
                     document.querySelector('canvas') as HTMLCanvasElement;

      if (!canvas) {
        console.warn('[App] No canvas found for screenshot');
        return;
      }

      // Capture full-resolution PNG blob from canvas
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        console.warn('[App] Failed to capture canvas blob');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `Screenshot_${timestamp}.png`;

      // Create blob URL for media library
      const blobUrl = URL.createObjectURL(blob);

      // Generate thumbnail (120x68)
      let thumbnail: string | undefined;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 120;
      thumbCanvas.height = 68;
      const ctx = thumbCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
      }

      // Add to media library as image
      mediaLibrary.addItem({
        id: generateUUID(),
        name: filename,
        type: 'image',
        src: blobUrl,
        thumbnail,
      });
      console.log('[App] Screenshot added to media library:', filename);

      // Save to the same folder used for recordings (File System Access API)
      const currentSettings = settings.get();
      const dirHandle = currentSettings.recording.saveDirectoryHandle;
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          console.log('[App] Screenshot saved to:', dirHandle.name + '/' + filename);
        } catch (err) {
          console.warn('[App] Failed to save screenshot to folder, falling back to download:', err);
          downloadBlob(blob, filename);
        }
      } else {
        // Fallback: browser download
        downloadBlob(blob, filename);
      }
    } catch (err) {
      console.error('[App] Screenshot failed:', err);
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Selected media layer plugin source state for sidebar tab routing
  $: selectedMediaSource = $selectedMediaLayer?.source ?? null;
  $: selectedPluginId = selectedMediaSource?.effectSource?.effectType ?? selectedMediaSource?.spoutSource?.pluginId ?? null;
  $: hasPluginControls = selectedPluginId === 'fluid' || selectedPluginId === 'fluidgen' || selectedPluginId === 'particles' || selectedPluginId === 'particles3d';
  // Auto-switch to plugin tab when a plugin layer is first selected
  let prevPluginId: string | null = null;
  $: if (hasPluginControls && selectedPluginId !== prevPluginId) {
    prevPluginId = selectedPluginId;
    mediaSidebarTab = 'plugin';
  }
  // Reset when no plugin controls, but only if we were on plugin tab
  $: if (!hasPluginControls && prevPluginId !== null) {
    prevPluginId = null;
    if (mediaSidebarTab === 'plugin') mediaSidebarTab = 'media';
  }

  // Open VJ Mode
  function openVJMode() {
    vjClipLauncher.setOpen(true);
    vjClipLauncher.setLive(true);
  }

  // Save current state as VJ preset (captures thumbnail)
  async function saveVJPreset() {
    const name = vjPresetName.trim() || `Preset ${($project.compositions || []).length + 1}`;

    // Capture canvas thumbnail
    let thumbnail: string | undefined;
    if (canvasComponent) {
      try {
        const canvas = document.querySelector('canvas.main-canvas') as HTMLCanvasElement ||
                       document.querySelector('.canvas-container canvas') as HTMLCanvasElement ||
                       document.querySelector('canvas') as HTMLCanvasElement;
        if (canvas) {
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 120;
          thumbCanvas.height = 68;
          const ctx = thumbCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
            thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
          }
        }
      } catch (e) {
        console.warn('Failed to capture thumbnail:', e);
      }
    }

    project.saveComposition(name, thumbnail);
    vjPresetName = '';
  }

  // ── Global error reporting to ghostarcade.live ──
  function reportError(error: string, stack?: string, context?: string, severity: string = 'error') {
    invoke('report_error', { error, stack, context, severity }).catch(() => {});
  }

  onMount(() => {
    // Phase 3.0 WebGPU bridge: when editorWebGPU is on, both Canvas
    // and WebGPUCanvas are mounted. Push the WebGL canvas DOM ref
    // from Canvas (via getCanvas()) into the WebGPU bridge's setter
    // so it knows what to sample. We poll for up to 2s in case
    // Canvas's own onMount hasn't fired yet — bind:this fires after
    // mount but Canvas's `canvas` element binding is set inside
    // ITS onMount which runs in a separate microtask.
    if ($settings.experimental?.editorWebGPU) {
      let attempts = 0;
      const tryPushSource = () => {
        const c = canvasComponent?.getCanvas?.();
        if (c && webgpuBridgeComponent) {
          webgpuBridgeComponent.setSourceCanvas(c);
          console.log('[App] WebGPU bridge source canvas wired:', c.width, 'x', c.height);
          return;
        }
        if (attempts++ < 40) setTimeout(tryPushSource, 50);
        else console.warn('[App] WebGPU bridge: source canvas never appeared (Canvas.getCanvas() returned null after 2s)');
      };
      // Defer to next tick so bind:this has fired on both children.
      setTimeout(tryPushSource, 0);
    }

    // Auto-report uncaught errors and promise rejections
    const onError = (e: ErrorEvent) => {
      reportError(e.message || 'Uncaught error', e.error?.stack, 'window.onerror', 'crash');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason || 'Unhandled rejection');
      reportError(msg, e.reason?.stack, 'unhandledrejection', 'error');
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    // Multi-select collapse on control interaction.
    // User report: drag-selecting on the canvas (which selects multiple
    // layers) then trying to use a slider in the property panel applied
    // the change to ALL selected layers — surprising and unwanted. This
    // handler watches for pointerdown on form controls inside any panel
    // and, if a multi-select is active, collapses it to just the
    // currently-active layer FIRST so the control affects only one
    // layer. Capture-phase so we beat any handlers on the controls.
    const collapseMultiSelectOnControl = (e: PointerEvent) => {
      const ids = get(selectedLayerIds);
      if (!ids || ids.length <= 1) return;
      const tgt = e.target as Element | null;
      if (!tgt) return;
      // Only collapse for actual editable controls — not arbitrary divs.
      const ctl = tgt.closest('input, select, textarea, button, [role="slider"]');
      if (!ctl) return;
      // Don't collapse for the canvas/viewport or the layer-row chrome
      // itself (visibility/lock/delete buttons live there and the user
      // expects those to apply to the multi-selection).
      if (tgt.closest('.viewport, .layer-row, .layer-list')) return;
      const active = get(selectedLayer);
      if (active) project.selectLayer(active.id);
    };
    window.addEventListener('pointerdown', collapseMultiSelectOnControl, true);

    // Save-on-close modal: existing showCloseModal infrastructure (modal
    // body + Save/Discard/Cancel buttons + handlers) was wired but never
    // TRIGGERED. Hook it up to the window's beforeunload event so users
    // get prompted before losing their work when they hit ⌘W / Alt+F4 /
    // the window's X button. preventDefault() keeps the window open
    // while we show the modal; the modal's button handlers call
    // window.close() programmatically when the user makes a choice.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      // Only intercept once — if the modal is already open, let the
      // user finish their decision (and the modal handler will close).
      if (showCloseModal) return;
      e.preventDefault();
      // Required for some browsers / Electron versions to honor
      // preventDefault and keep the window open.
      e.returnValue = '';
      showCloseModal = true;
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Background update check — first run shows cached result if any,
    // then re-fetches if it's been > 24 h since last check. Manual
    // "Check now" from Settings calls runVersionCheck(true).
    runVersionCheck(false);

    // No license check in the OSS build — go straight to first-run UX.
    initLicense().then(() => {
      const welcomeSeen = localStorage.getItem('ghostarcade-welcome-seen');
      if (!welcomeSeen) {
        showWelcome = true;
      } else {
        // Welcome already seen — still try the first-launch demo import.
        maybeAutoLoadDemo();
      }
    });

    // Check for app updates (compares against latest GitHub release)
    startUpdateChecker();

    // Start preloading shaders in background (non-blocking — don't wait for completion)
    preloadShaderLibrary().catch(() => {});

    // Populate the mobile-sync shader list in parallel. preloadShaderLibrary
    // also calls this when it finishes, but it bails early when the
    // window cache is already warm (from a prior MediaTray mount), and we
    // need this to run unconditionally so mobile gets the list even when
    // preload short-circuits.
    populateShaderListForSync().catch(() => {});

    // Show the main window and dismiss splash immediately
    invoke('show_main_window').catch(() => {
      // Not running in Tauri/Electron (dev browser) — window is already visible
    });
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    // Wire up history recording callback for the project store
    setHistoryCallback(() => recordHistory());

    // Simple routing: check URL hash
    isMobile = window.location.hash === '#/mobile' || window.location.pathname.includes('mobile');
    window.addEventListener('hashchange', () => {
      isMobile = window.location.hash === '#/mobile';
    });

    // Allow child components (e.g. VJ mode) to open settings via custom event
    window.addEventListener('open-settings', () => { showSettings = true; });

    // Load saved AI shaders from server
    loadShadersFromServer().catch(e => {
      console.debug('Failed to load shaders from server (this is OK if server is not running):', e);
    });

    // Hydrate cloud shaders from the user data directory on disk.
    // Disk is the source of truth for synced cloud shaders — survives
    // localStorage clears and reinstalls. No-op outside Electron.
    loadCloudShadersFromDisk().catch(e => {
      console.debug('Disk shader hydration skipped:', e);
    });

    // Start Spout sender scanner (desktop only — detects available Spout senders)
    startSpoutScanner();

    // Initialize MIDI controller support
    midiManager.init().then(ok => {
      if (ok) console.log('[MIDI] Ready — devices detected');
    });

    // Auto-connect to built-in WebSocket server (Tauri desktop or dev with server running)
    // Try connecting after a short delay to let the Rust WS server start
    if (!isMobile) {
      const autoConnect = () => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectToServer();
        }
      };
      // Initial attempt after 1s (give Rust server time to bind)
      setTimeout(autoConnect, 1000);
      // Retry every 5s if not connected
      const retryInterval = setInterval(() => {
        if (wsServerReady) {
          clearInterval(retryInterval);
        } else {
          autoConnect();
        }
      }, 5000);
    }

    // Listen for drawing mode changes from LinesPanel
    const handleLinesModeChange = (e: CustomEvent<{ mode: 'none' | 'freehand' | 'pointClick' }>) => {
      linesDrawingMode = e.detail.mode;
      linesDrawingPoints = [];
      isLinesDrawing = false;
    };
    window.addEventListener('lines-mode-change', handleLinesModeChange as EventListener);
    const handleLayerShapeWarpToggle = (e: CustomEvent<{ enabled: boolean }>) => {
      shapeWarpModeEnabled = !!e.detail?.enabled;
      if (shapeWarpModeEnabled) ensureActiveLayerShapeControlPoints();
    };
    window.addEventListener('toggle-layer-shape-warp', handleLayerShapeWarpToggle as EventListener);

    // Window close interception removed — Electron handles this via main-process
    // 'before-quit' handlers if needed in the future.

    // Initialize saved state snapshot
    markAsSaved();

    // --- Crash recovery: check for auto-saved project ---
    const savedAutosave = localStorage.getItem('ghostarcade-autosave');
    if (savedAutosave) {
      const ts = localStorage.getItem('ghostarcade-autosave-timestamp');
      recoveryTimestamp = ts ? new Date(parseInt(ts, 10)).toLocaleString() : 'unknown time';
      showRecoveryModal = true;
    }

    // --- Auto-save interval: every 30 seconds ---
    autosaveInterval = setInterval(() => {
      const proj = get(project);
      if (proj.layers.length > 0) {
        try {
          const jsonStr = project.exportProjectJSON();
          localStorage.setItem('ghostarcade-autosave', jsonStr);
          localStorage.setItem('ghostarcade-autosave-timestamp', Date.now().toString());
        } catch (e) {
          console.warn('[AutoSave] Failed to auto-save project:', e);
        }
      }
    }, 30000);

    // Keyboard handlers for spacebar panning + undo/redo
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // ESC exits lines drawing mode
      if (e.key === 'Escape' && linesDrawingMode !== 'none') {
        linesDrawingMode = 'none';
        isLinesDrawing = false;
        linesDrawingPoints = [];
        window.dispatchEvent(new CustomEvent('lines-mode-change', { detail: { mode: 'select' } }));
        e.preventDefault();
        return;
      }

      // ESC exits MIDI edit mode
      if (e.key === 'Escape' && get(midiStore).editMode) {
        midiStore.setEditMode(false);
        e.preventDefault();
        return;
      }

      // ESC closes shortcut help overlay
      if (e.key === 'Escape' && showShortcutHelp) {
        showShortcutHelp = false;
        e.preventDefault();
        return;
      }

      // ? key toggles shortcut help overlay (don't trigger in inputs)
      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        showShortcutHelp = !showShortcutHelp;
        e.preventDefault();
        return;
      }

      // B key toggles blackout (not in inputs)
      if ((e.key === 'b' || e.key === 'B') && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        settings.update(s => ({ ...s, output: { ...s.output, blackout: !s.output.blackout } }));
        e.preventDefault();
        return;
      }

      // T key cycles test patterns (not in inputs)
      if ((e.key === 't' || e.key === 'T') && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const patterns = ['none', 'grid', 'crosshair', 'color-bars', 'white', 'gradient', 'checkerboard'];
        settings.update(s => {
          const idx = patterns.indexOf(s.output.testPattern ?? 'none');
          const next = patterns[(idx + 1) % patterns.length];
          return { ...s, output: { ...s.output, testPattern: next } };
        });
        e.preventDefault();
        return;
      }

      // VJ Mode keyboard shortcuts: 1-9/0 for columns, F1-F8 for blocks.
      // Skip when SynthVision/Performer is active — those keys belong to
      // SynthVision's own document keydown handler in that mode, and the VJ
      // desk would otherwise steal them even with the VJ panel open.
      if (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const vjState = get(vjClipLauncher);
        const svState = get(synthVisionStore);
        if (vjState.isOpen && !svState.active) {
          // Number keys 1-9 trigger columns 0-8, 0 triggers column 9
          const num = parseInt(e.key, 10);
          if (!isNaN(num) && e.key.length === 1 && e.key >= '0' && e.key <= '9') {
            const colIdx = num === 0 ? 9 : num - 1;
            vjClipLauncher.triggerColumn(colIdx);
            e.preventDefault();
            return;
          }
          // F1-F8 switch blocks 0-7
          if (e.key.startsWith('F') && e.key.length <= 3) {
            const fNum = parseInt(e.key.slice(1), 10);
            if (fNum >= 1 && fNum <= 8 && fNum - 1 < vjState.blocks.length) {
              vjClipLauncher.setActiveBlock(vjState.blocks[fNum - 1].id);
              e.preventDefault();
              return;
            }
          }
        }
      }

      // Undo: Ctrl+Z (works even when typing — standard behavior)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Save: Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        saveComposition();
        return;
      }

      // Copy: Ctrl+C (supports multi-selection)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        if (inInput) return;
        const selIds = get(selectedLayerIds);
        const proj = get(project);
        if (selIds.length > 0) {
          // Copy all selected layers
          clipboardLayers = [];
          for (const id of selIds) {
            const layer = proj.layers.find(l => l.id === id);
            if (layer) {
              const { texture, videoElement, ...safeLayer } = layer as any;
              clipboardLayers.push(JSON.stringify(safeLayer));
            }
          }
        } else {
          // Fallback: copy single selected layer
          const sel = get(selectedLayer);
          if (sel) {
            const { texture, videoElement, ...safeLayer } = sel as any;
            clipboardLayers = [JSON.stringify(safeLayer)];
          }
        }
        return;
      }

      // Paste: Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey) {
        if (inInput) return;
        if (clipboardLayers.length > 0) {
          e.preventDefault();
          const proj = get(project);
          for (let ci = 0; ci < clipboardLayers.length; ci++) {
            const parsed = JSON.parse(clipboardLayers[ci]);
            const offset = 0.02 * (ci + 1);
            const newLayer: Layer = {
              ...parsed,
              id: generateUUID(),
              name: parsed.name + ' Copy',
              texture: undefined,
              videoElement: undefined,
              corners: {
                topLeft: { x: parsed.corners.topLeft.x + offset, y: parsed.corners.topLeft.y - offset },
                topRight: { x: parsed.corners.topRight.x + offset, y: parsed.corners.topRight.y - offset },
                bottomLeft: { x: parsed.corners.bottomLeft.x + offset, y: parsed.corners.bottomLeft.y - offset },
                bottomRight: { x: parsed.corners.bottomRight.x + offset, y: parsed.corners.bottomRight.y - offset },
              }
            };
            project.update(p => ({ ...p, layers: [newLayer, ...p.layers] }));
            project.selectLayer(newLayer.id);
          }
          recordHistory();
        }
        return;
      }

      // Duplicate: Ctrl+D
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (inInput) return;
        e.preventDefault();
        const sel = get(selectedLayer);
        if (sel) {
          project.duplicateLayer(sel.id);
          recordHistory();
        }
        return;
      }

      // Delete selected layer: Delete or Backspace key.
      // BUT: if a keyframe is currently selected in the timeline,
      // the user pressing Delete intends to delete that keyframe —
      // not blow away the entire layer.  Without this guard, the
      // global handler races ahead and `project.removeLayer(sel.id)`
      // takes out the whole mapping layer the moment the user clicks
      // a kf bubble and hits Delete (on macOS Backspace too —
      // there's no separate forward-delete on most Mac keyboards).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (inInput) return;
        const kfSel = get(keyframeTimeline).selectedKeyframe;
        if (kfSel) {
          e.preventDefault();
          keyframeTimeline.removeKeyframe(kfSel.layerId, kfSel.trackKey, kfSel.time);
          return;
        }
        const sel = get(selectedLayer);
        if (sel) {
          e.preventDefault();
          project.removeLayer(sel.id);
        }
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        if (inInput) return;
        e.preventDefault();
        isSpacePressed = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed = false;
        // Stop panning when space is released
        if (isPanning) {
          isPanning = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Close file menu when clicking outside
    document.addEventListener('click', handleClickOutside);

    // Attach wheel handler with {passive: false} so preventDefault() works in Electron/Chromium.
    // Must be synchronous (not deferred via rAF) to register before compositor claims wheel events.
    // Svelte's onwheel uses passive listeners by default, which silently ignores preventDefault().
    if (viewportEl) {
      viewportEl.addEventListener('wheel', handleViewportWheel, { passive: false });
    }

    updateViewportSize();

    // Window resize listener so layer bounds snap immediately when resizing the app
    const handleWindowResize = () => {
      updateViewportSize();
      requestAnimationFrame(() => updateViewportSize());
    };
    window.addEventListener('resize', handleWindowResize);

    // Use ResizeObserver on viewport so viewportWidth/Height update when sidebars open/close
    const viewportResizeObserver = new ResizeObserver(() => {
      updateViewportSize();
    });
    if (viewportEl) {
      viewportResizeObserver.observe(viewportEl);
      // Also observe the canvas container directly for size changes
      const canvasContainer = viewportEl.querySelector('.canvas-container');
      if (canvasContainer) viewportResizeObserver.observe(canvasContainer);
      // Force immediate viewport size calculation to prevent stale 800x600 defaults
      updateViewportSize();
      // Schedule deferred updates as Electron window chrome and layout settle
      requestAnimationFrame(() => updateViewportSize());
      setTimeout(() => updateViewportSize(), 100);
      setTimeout(() => updateViewportSize(), 300);
      setTimeout(() => updateViewportSize(), 500);
      setTimeout(() => updateViewportSize(), 1000);
      setTimeout(() => updateViewportSize(), 2000);
      // Watch for canvas container appearing (if it mounts later)
      const mo = new MutationObserver(() => {
        const cc = viewportEl.querySelector('.canvas-container');
        if (cc) { viewportResizeObserver.observe(cc); updateViewportSize(); mo.disconnect(); }
      });
      mo.observe(viewportEl, { childList: true, subtree: true });
    }

    return () => {
      window.removeEventListener('lines-mode-change', handleLinesModeChange as EventListener);
      window.removeEventListener('toggle-layer-shape-warp', handleLayerShapeWarpToggle as EventListener);
      endShapeControlPointDrag();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('click', handleClickOutside);
      viewportResizeObserver.disconnect();
      destroyLicense();
    };
  });

  // Track viewport size and actual canvas position for warp handles.
  // The canvas-container is the element that holds the WebGL canvas and is aspect-ratio
  // constrained + centered by flexbox. We measure it directly from the DOM so the overlay
  // handles match exactly where the shader renders — no computed guesswork.
  function updateViewportSize() {
    if (viewportEl) {
      viewportWidth = viewportEl.offsetWidth;
      viewportHeight = viewportEl.offsetHeight;
    }

    // Measure overlay alignment using offsetWidth/offsetHeight (layout pixels, NOT
    // affected by CSS transforms). This matches exactly how Canvas.svelte sizes its
    // container via sizeContainer() — both use offsetWidth, so they always agree.
    // NEVER use getBoundingClientRect() here — it goes through the CSS transform
    // compositing layer and produces unreliable results in Electron's Chromium.
    const containerEl = viewportEl?.querySelector('.canvas-container') as HTMLElement | null;
    const wrapperEl = viewportEl?.querySelector('.canvas-wrapper') as HTMLElement | null;
    if (containerEl && wrapperEl) {
      const cw = containerEl.offsetWidth;
      const ch = containerEl.offsetHeight;
      const ww = wrapperEl.offsetWidth;
      const wh = wrapperEl.offsetHeight;
      if (cw > 0 && ch > 0) {
        measuredCanvasWidth = cw;
        measuredCanvasHeight = ch;
        // Container is centered by flexbox within wrapper
        measuredCanvasOffsetX = (ww - cw) / 2;
        measuredCanvasOffsetY = (wh - ch) / 2;
      }
    }
  }

  // Measured canvas dimensions from Canvas component (updated by updateViewportSize)
  let measuredCanvasOffsetX: number | undefined;
  let measuredCanvasOffsetY: number | undefined;
  let measuredCanvasWidth: number | undefined;
  let measuredCanvasHeight: number | undefined;

  /**
   * Bilinear interpolation: map a normalized (0-1) UV point through the layer's corner warp.
   * Returns the point in canvas-normalized (0-1) space.
   */
  function warpPointThroughCorners(corners: WarpCorners, u: number, v: number): Point2D {
    // u = horizontal (0=left, 1=right), v = vertical (0=bottom, 1=top) in our Y-up system
    const u1 = 1 - u;
    const v1 = 1 - v;
    return {
      x: corners.bottomLeft.x * u1 * v1
        + corners.bottomRight.x * u * v1
        + corners.topLeft.x * u1 * v
        + corners.topRight.x * u * v,
      y: corners.bottomLeft.y * u1 * v1
        + corners.bottomRight.y * u * v1
        + corners.topLeft.y * u1 * v
        + corners.topRight.y * u * v,
    };
  }

  /**
   * Inverse bilinear: map a canvas-normalized point back to the layer's local UV space.
   * Uses Newton-Raphson iteration. Returns { x: u, y: v }.
   */
  function inverseBilinearCorners(corners: WarpCorners, px: number, py: number): Point2D {
    let u = 0.5, v = 0.5;
    for (let i = 0; i < 8; i++) {
      const mapped = warpPointThroughCorners(corners, u, v);
      const ex = px - mapped.x;
      const ey = py - mapped.y;
      if (Math.abs(ex) < 0.0001 && Math.abs(ey) < 0.0001) break;

      // Partial derivatives
      const v1 = 1 - v;
      const dxdu = -corners.bottomLeft.x * v1 + corners.bottomRight.x * v1 - corners.topLeft.x * v + corners.topRight.x * v;
      const dxdv = -corners.bottomLeft.x * (1 - u) - corners.bottomRight.x * u + corners.topLeft.x * (1 - u) + corners.topRight.x * u;
      const dydu = -corners.bottomLeft.y * v1 + corners.bottomRight.y * v1 - corners.topLeft.y * v + corners.topRight.y * v;
      const dydv = -corners.bottomLeft.y * (1 - u) - corners.bottomRight.y * u + corners.topLeft.y * (1 - u) + corners.topRight.y * u;

      const det = dxdu * dydv - dxdv * dydu;
      if (Math.abs(det) < 1e-8) break;

      u += (ex * dydv - ey * dxdv) / det;
      v += (dxdu * ey - dydu * ex) / det;
    }
    return { x: Math.max(0, Math.min(1, u)), y: Math.max(0, Math.min(1, v)) };
  }

  function isLayerShapeWarpable(layer: Layer | null | undefined): boolean {
    const t = layer?.layerShape?.type;
    return !!t && (t === 'circle' || t === 'triangle');
  }

  function getDefaultLayerShapeControlPoints(type: 'circle' | 'triangle'): Point2D[] {
    if (type === 'circle') {
      return [
        { x: 0.2, y: 0.8 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.5, y: 0.5 },
      ];
    }
    return [
      { x: 0.5, y: 0.88 },
      { x: 0.14, y: 0.14 },
      { x: 0.86, y: 0.14 },
    ];
  }

  function ensureActiveLayerShapeControlPoints() {
    if (!$selectedLayer || !$selectedLayer.layerShape || !isLayerShapeWarpable($selectedLayer)) return;
    const existing = $selectedLayer.layerShape.controlPoints;
    if (existing && existing.length > 0) return;
    const shapeType = $selectedLayer.layerShape.type as 'circle' | 'triangle';
    project.initShapeControlPoints($selectedLayer.id, getDefaultLayerShapeControlPoints(shapeType));
  }

  function startShapeControlPointDrag(index: number, e: MouseEvent) {
    if (!$selectedLayer || !$selectedLayer.layerShape) return;
    e.preventDefault();
    e.stopPropagation();
    ensureActiveLayerShapeControlPoints();
    draggingShapeControlPointIndex = index;
    window.addEventListener('mousemove', handleShapeControlPointDrag);
    window.addEventListener('mouseup', endShapeControlPointDrag);
  }

  function handleShapeControlPointDrag(e: MouseEvent) {
    if (draggingShapeControlPointIndex === null || !$selectedLayer || !$selectedLayer.layerShape || !shapeWarpOverlayEl) return;
    const rect = shapeWarpOverlayEl.getBoundingClientRect();
    // Get canvas-normalized coords from mouse position
    const canvasNormX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const canvasNormY = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));

    // Inverse-transform through layer corners to get local UV coords
    const corners = $selectedLayer.corners;
    if (corners) {
      const local = inverseBilinearCorners(corners, canvasNormX, canvasNormY);
      project.setShapeControlPoint($selectedLayer.id, draggingShapeControlPointIndex, local);
    } else {
      project.setShapeControlPoint($selectedLayer.id, draggingShapeControlPointIndex, { x: canvasNormX, y: canvasNormY });
    }
  }

  function endShapeControlPointDrag() {
    if (draggingShapeControlPointIndex !== null) recordHistory();
    draggingShapeControlPointIndex = null;
    window.removeEventListener('mousemove', handleShapeControlPointDrag);
    window.removeEventListener('mouseup', endShapeControlPointDrag);
  }

  // Viewport pan/zoom handlers
  function handleViewportWheel(e: WheelEvent) {
    e.preventDefault();

    // Get mouse position relative to viewport
    const rect = viewportEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewportZoom * zoomFactor));

    // Adjust pan to zoom towards mouse position
    const zoomRatio = newZoom / viewportZoom;
    viewportPanX = mouseX - (mouseX - viewportPanX) * zoomRatio;
    viewportPanY = mouseY - (mouseY - viewportPanY) * zoomRatio;

    viewportZoom = newZoom;
  }

  // ── Layer hit-testing for click-to-select ──

  /** Cross product sign for point-in-triangle test */
  function triSign(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  }

  /** Point-in-triangle using barycentric sign method */
  function pointInTriangle(px: number, py: number, v1: Point2D, v2: Point2D, v3: Point2D): boolean {
    const d1 = triSign(px, py, v1.x, v1.y, v2.x, v2.y);
    const d2 = triSign(px, py, v2.x, v2.y, v3.x, v3.y);
    const d3 = triSign(px, py, v3.x, v3.y, v1.x, v1.y);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  /** Point-in-quad: split the quad into two triangles and test both */
  function pointInQuad(px: number, py: number, corners: WarpCorners): boolean {
    const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = corners;
    return pointInTriangle(px, py, tl, tr, br) || pointInTriangle(px, py, tl, br, bl);
  }

  /** Hit-test layers (topmost first). Returns layer id or null. */
  function hitTestLayers(normalizedX: number, normalizedY: number): string | null {
    const currentLayers = get(project).layers;
    // layers[0] is rendered on top (engine.render reverses the plan), so
    // iterate forward to hit the visually topmost layer first.
    for (let i = 0; i < currentLayers.length; i++) {
      const layer = currentLayers[i];
      if (!layer.visible || layer.locked) continue;
      if (!layer.corners || !pointInQuad(normalizedX, normalizedY, layer.corners)) continue;
      // For layers with a non-rect layerShape, narrow the hit to the
      // actual polygon — bbox quad is a click-area trap; users
      // dragging across a busy stage of polygons would lose select
      // accuracy on overlapping bboxes. Tessellate the customPoints
      // (so beziers contribute their curve, not just their anchors)
      // and run a ray-cast point-in-polygon test in layer-local UV
      // space (inverseBilinear unwraps the warp).
      const shape = layer.layerShape;
      if (
        shape?.enabled &&
        shape.type === 'custom' &&
        shape.params?.customPoints &&
        shape.params.customPoints.length >= 3
      ) {
        const local = inverseBilinearCorners(layer.corners, normalizedX, normalizedY);
        const tessellated = tessellateBezierPolygon(shape.params.customPoints);
        if (!pointInPolygon2D(local.x, local.y, tessellated)) {
          continue;  // Inside the bbox but outside the shape → skip.
        }
      }
      return layer.id;
    }
    return null;
  }

  /** Tessellate a BezierPoint[] polygon into a dense point list for
   *  hit-testing.  Mirrors engine.ts tessellateMaskShape but in this
   *  module to avoid pulling renderer code into the UI layer. 16
   *  samples per curve segment is enough resolution for click
   *  accuracy without hot-path overhead. */
  function tessellateBezierPolygon(anchors: import('./lib/types').BezierPoint[]): Point2D[] {
    const out: Point2D[] = [];
    const STEPS = 16;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      out.push({ x: a.x, y: a.y });
      if (a.cpOut || b.cpIn) {
        const cp1 = a.cpOut ?? a;
        const cp2 = b.cpIn  ?? b;
        for (let s = 1; s < STEPS; s++) {
          const t = s / STEPS, mt = 1 - t;
          out.push({
            x: mt*mt*mt*a.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*b.x,
            y: mt*mt*mt*a.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*b.y,
          });
        }
      }
    }
    return out;
  }

  function pointInPolygon2D(px: number, py: number, poly: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Clipboard state for copy/paste
  let clipboardLayers: string[] = []; // Serialized JSON strings (safe to clone)

  function handleViewportMouseDown(e: MouseEvent) {
    // Middle mouse button, Alt+left click, or Space+left click for panning
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      e.stopPropagation();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartPanX = viewportPanX;
      panStartPanY = viewportPanY;
      return;
    }

    // Left click: hit-test layers for click-to-select (supports Ctrl/Cmd multi-select)
    if (e.button === 0 && viewportEl) {
      // Only fire when clicking the viewport background or canvas — not on handles/overlays
      const target = e.target as HTMLElement;
      if (target.closest('.warp-handles-offset') || target.closest('.shape-interaction-overlay')) return;

      const rect = viewportEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to content coordinates (undo pan and zoom)
      const contentX = (mouseX - viewportPanX) / viewportZoom;
      const contentY = (mouseY - viewportPanY) / viewportZoom;

      // Convert to normalized 0-1 coords within the canvas area
      const normalizedX = (contentX - canvasOffsetX) / canvasWidth;
      const normalizedY = 1 - ((contentY - canvasOffsetY) / canvasHeight); // Flip Y for OpenGL

      // Only test if click is within canvas bounds
      if (normalizedX >= 0 && normalizedX <= 1 && normalizedY >= 0 && normalizedY <= 1) {
        const hitLayerId = hitTestLayers(normalizedX, normalizedY);
        const isToggle = e.ctrlKey || e.metaKey;

        if (hitLayerId) {
          if (isToggle) {
            // Ctrl/Cmd+click: toggle layer in/out of multi-selection
            const currentIds = get(selectedLayerIds);
            const exists = currentIds.includes(hitLayerId);
            const nextIds = exists
              ? currentIds.filter(id => id !== hitLayerId)
              : [...currentIds, hitLayerId];
            project.setLayerSelection(hitLayerId, nextIds.length > 0 ? nextIds : [hitLayerId]);
          } else {
            // Normal click: single select
            project.selectLayer(hitLayerId);
          }
        } else if (!isToggle) {
          // Click on empty area: deselect
          project.selectLayer(null);
        }

        // Start drag-select box tracking (for marquee selection)
        if (!hitLayerId && !isToggle) {
          dragSelectStart = { x: normalizedX, y: normalizedY };
          dragSelectCurrent = null;
          isDragSelecting = false;

          const onDragMove = (me: MouseEvent) => {
            const r = viewportEl!.getBoundingClientRect();
            const mx = me.clientX - r.left;
            const my = me.clientY - r.top;
            const cx = (mx - viewportPanX) / viewportZoom;
            const cy = (my - viewportPanY) / viewportZoom;
            const nx = (cx - canvasOffsetX) / canvasWidth;
            const ny = 1 - ((cy - canvasOffsetY) / canvasHeight);
            dragSelectCurrent = { x: nx, y: ny };
            isDragSelecting = true;

            // Hit-test all layers within the drag rectangle
            const minX = Math.min(dragSelectStart!.x, nx);
            const maxX = Math.max(dragSelectStart!.x, nx);
            const minY = Math.min(dragSelectStart!.y, ny);
            const maxY = Math.max(dragSelectStart!.y, ny);

            const currentLayers = get(project).layers;
            const hitIds: string[] = [];
            for (const layer of currentLayers) {
              if (!layer.visible || layer.locked || !layer.corners) continue;
              // Check if any corner of the layer falls within the selection box
              const c = layer.corners;
              const corners = [c.topLeft, c.topRight, c.bottomLeft, c.bottomRight];
              const layerInBox = corners.some(pt => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY);
              // Also check if the center of the layer is in the box
              const centerX = (c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4;
              const centerY = (c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4;
              const centerInBox = centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
              if (layerInBox || centerInBox) hitIds.push(layer.id);
            }
            if (hitIds.length > 0) {
              project.setLayerSelection(hitIds[0], hitIds);
            }
          };

          const onDragUp = () => {
            window.removeEventListener('mousemove', onDragMove);
            window.removeEventListener('mouseup', onDragUp);
            dragSelectStart = null;
            dragSelectCurrent = null;
            isDragSelecting = false;
          };

          window.addEventListener('mousemove', onDragMove);
          window.addEventListener('mouseup', onDragUp);
        }
      }
    }
  }

  // Drag-select state
  let dragSelectStart: { x: number; y: number } | null = null;
  let dragSelectCurrent: { x: number; y: number } | null = null;
  let isDragSelecting = false;

  function handleViewportMouseMove(e: MouseEvent) {
    if (isPanning) {
      viewportPanX = panStartPanX + (e.clientX - panStartX);
      viewportPanY = panStartPanY + (e.clientY - panStartY);
    }

    // Send cursor position to output window (normalized 0-1 canvas coordinates)
    if (viewportEl) {
      const coords = mouseToCanvasCoords(e);
      if (coords.x >= 0 && coords.x <= 1 && coords.y >= 0 && coords.y <= 1) {
        import('./lib/sync/stateBroadcast').then(m => m.broadcastCursorPosition(coords.x, coords.y));
      }
    }
  }

  function handleViewportMouseUp(e: MouseEvent) {
    if (e.button === 1 || e.button === 0) {
      isPanning = false;
    }
  }

  function handleViewportMouseLeave() {
    // Clear cursor on output window when mouse leaves viewport
    import('./lib/sync/stateBroadcast').then(m => m.broadcastCursorClear());
  }

  function resetViewportTransform() {
    viewportZoom = 1;
    viewportPanX = 0;
    viewportPanY = 0;
  }

  // WebSocket connection state for mobile
  let wsServerReady = false;   // Desktop is connected to WS server (can show QR)
  let mobileConnected = false; // At least one mobile client is connected
  let clientCount = 0;
  let wsPort = 9001;
  let httpPort = 9002; // HTTP info server port
  const LP_LIVE_PREVIEW_SYNC_INTERVAL_MS = 50;
  const LP_LIVE_PREVIEW_MAX_POINTS = 300;

  function resampleLightPaintingPreviewPoints(points: any[], maxCount = LP_LIVE_PREVIEW_MAX_POINTS) {
    if (points.length <= maxCount) return points.slice();

    const result: any[] = [];
    const step = (points.length - 1) / (maxCount - 1);
    for (let i = 0; i < maxCount; i++) {
      const idx = i * step;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, points.length - 1);
      const t = idx - lo;
      const a = points[lo];
      const b = points[hi];
      result.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: (a.pressure ?? 0.5) + ((b.pressure ?? 0.5) - (a.pressure ?? 0.5)) * t,
        timestamp: (a.timestamp ?? 0) + ((b.timestamp ?? 0) - (a.timestamp ?? 0)) * t,
      });
    }
    return result;
  }

  function cancelMobileLightPaintingPreview(state: any) {
    if (state?.previewRafId !== null && state?.previewRafId !== undefined) {
      cancelAnimationFrame(state.previewRafId);
      state.previewRafId = null;
    }
  }

  function flushMobileLightPaintingPreview(state: any, force = false) {
    if (!state || state.points.length < 2) return;

    const now = performance.now();
    if (!force && now - (state.lastPreviewSyncTime ?? 0) < LP_LIVE_PREVIEW_SYNC_INTERVAL_MS) return;

    state.lastPreviewSyncTime = now;
    project.updateLightPaintingContent(state.layerId, {
      livePreviewStroke: {
        points: resampleLightPaintingPreviewPoints(state.points),
        brush: state.brush,
      },
    });
  }

  function scheduleMobileLightPaintingPreview(state: any) {
    if (!state || state.previewRafId != null) return;
    state.previewRafId = requestAnimationFrame(() => {
      state.previewRafId = null;
      flushMobileLightPaintingPreview(state);
    });
  }

  let ws: WebSocket | null = null;

  // Connect to WebSocket server as desktop host
  let connectionError = '';

  function connectToServer() {
    connectionError = '';
    const url = `ws://127.0.0.1:${wsPort}`;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      connectionError = 'Failed to create WebSocket connection. Is the server running?';
      console.error('WebSocket creation failed:', err);
      return;
    }

    ws.onopen = () => {
      wsServerReady = true;
      connectionError = '';
      // Register as desktop client — mobileConnected will be set by client_count messages
      ws?.send(JSON.stringify({ type: 'register_desktop' }));
      // Send initial state
      syncState();
    };

    ws.onclose = () => {
      wsServerReady = false;
      mobileConnected = false;
      clientCount = 0;
    };

    ws.onerror = (event) => {
      mobileConnected = false;
      connectionError = 'Could not connect to WebSocket server. Retrying...';
      console.error('WebSocket error:', event);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }

  // Whitelist a bank value coming off the wire. Defaults garbage / null /
  // undefined / 'C' / etc. to 'A' so a malformed mobile payload can't push
  // unexpected values into the vjClipLauncher store. Used by every
  // bank-aware case in handleServerMessage.
  function safeBank(b: any): 'A' | 'B' { return b === 'B' ? 'B' : 'A'; }

  function handleServerMessage(msg: { type: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'client_count':
        clientCount = msg.count as number;
        // Desktop itself is 1 client; mobile clients = total - 1
        mobileConnected = clientCount > 1;
        break;

      case 'request_resync':
        // Server is asking us to re-send state (mobile connected before we sent)
        console.log('[Desktop] Server requested re-sync, sending current state');
        syncState();
        syncMediaLibrary();
        // Push the current freeze state too so the mobile pause/play pill
        // reflects reality from the moment it mounts (rather than waiting
        // for the user to toggle it for the first time).
        syncOutputFreeze(get(outputFrozen));
        break;

      case 'control_point': {
        const { layerId, corner, position } = (msg as unknown) as {
          layerId: string;
          corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
          position: { x: number; y: number };
        };
        project.setCorner(layerId, corner, position);
        break;
      }

      case 'mesh_point': {
        const { layerId, row, col, position } = (msg as unknown) as {
          layerId: string;
          row: number;
          col: number;
          position: { x: number; y: number };
        };
        project.setMeshPoint(layerId, row, col, position);
        break;
      }

      case 'parameter': {
        const { layerId, param, value } = (msg as unknown) as {
          layerId: string;
          param: string;
          value: number | string | boolean;
        };
        if (param === 'opacity' && typeof value === 'number') {
          project.setLayerOpacity(layerId, value);
        } else if (param === 'blendMode' && typeof value === 'string') {
          project.setLayerBlendMode(layerId, value as import('./lib/types').BlendMode);
        } else if (param === 'visible' && typeof value === 'boolean') {
          if (value) {
            // Make visible
            const layer = $project.layers.find(l => l.id === layerId);
            if (layer && !layer.visible) project.toggleLayerVisibility(layerId);
          } else {
            // Make hidden
            const layer = $project.layers.find(l => l.id === layerId);
            if (layer && layer.visible) project.toggleLayerVisibility(layerId);
          }
        }
        break;
      }

      case 'select_layer':
        project.selectLayer(msg.layerId as string);
        break;

      case 'warp_mode': {
        const { layerId, mode } = (msg as unknown) as { layerId: string; mode: 'corners' | 'mesh' };
        project.setWarpMode(layerId, mode);
        break;
      }

      case 'mesh_resize': {
        const { layerId, rows, cols } = (msg as unknown) as { layerId: string; rows: number; cols: number };
        project.setMeshGridSize(layerId, rows, cols);
        break;
      }

      case 'set_layer_source': {
        // Mobile triggered a media source
        const { layerId, sourceType, sourceSrc, sourceName } = (msg as unknown) as {
          layerId: string;
          sourceType: 'threejs' | 'color' | 'shader' | 'video' | 'image';
          sourceSrc: string;
          sourceName: string;
        };

        if (sourceType === 'threejs') {
          // Set threejs source on layer
          const source: import('./lib/types').MediaSource = {
            id: generateUUID(),
            type: 'threejs',
            src: sourceSrc,
            name: sourceName,
          };
          project.setLayerSource(layerId, source);
        } else if (sourceType === 'color') {
          // Set color source on layer
          const source: import('./lib/types').MediaSource = {
            id: generateUUID(),
            type: 'color',
            src: sourceSrc,
            name: sourceName,
          };
          project.setLayerSource(layerId, source);
        } else if (sourceType === 'shader') {
          // Two src formats from mobile:
          //   - "library-shader:<id>" → look up code in the shaderLibrary store
          //     (custom user shaders, AI-generated, cloud-synced — none are
          //     fetchable over HTTP)
          //   - normal HTTP URL → fetch the .fs file from public/ISF/...
          (async () => {
            try {
              let shaderCode: string;
              if (sourceSrc.startsWith('library-shader:')) {
                const id = sourceSrc.slice('library-shader:'.length);
                const lib = get(shaderLibrary);
                const saved = lib.shaders.find(s => s.id === id);
                if (!saved) {
                  console.warn('[Mobile shader trigger] not found in library:', id);
                  return;
                }
                shaderCode = saved.code;
              } else {
                const response = await fetch(sourceSrc);
                shaderCode = await response.text();
              }
              const source: import('./lib/types').MediaSource = {
                id: generateUUID(),
                type: 'shader',
                src: sourceSrc,
                name: sourceName,
                shaderCode,
              };
              project.setLayerSource(layerId, source);
            } catch (err) {
              console.error('Failed to load shader from mobile trigger:', err);
            }
          })();
        } else if (sourceType === 'video' || sourceType === 'image') {
          // Set video/image source - find it in the media library
          const mediaItem = $mediaLibrary.find(m => m.src === sourceSrc);
          if (mediaItem) {
            const source: import('./lib/types').MediaSource = {
              id: generateUUID(),
              type: sourceType,
              src: sourceSrc,
              name: sourceName,
              videoElement: mediaItem.videoElement,
              // Carry the library item's durable AssetRef so save+reload
              // restores the original disk file instead of a dead blob URL.
              _assetRef: (mediaItem as any)._assetRef,
            };
            project.setLayerSource(layerId, source);
          } else {
            console.warn('Media item not found in library:', sourceSrc);
          }
        }
        break;
      }

      // ── Bank-aware mobile-input handlers ──
      // `bank` defaults to 'A' for backward compat with older mobile
      // builds. `safeBank()` (defined at module scope further up) whitelists
      // to 'A' | 'B' so a malformed payload can't push garbage into the
      // launcher store. The store already does its own pickGrid fallback,
      // but defending at the boundary is cheap and makes intent explicit.
      case 'trigger_vj_clip': {
        const { layerIndex, columnIndex, bank } = (msg as unknown) as {
          layerIndex: number;
          columnIndex: number;
          bank?: 'A' | 'B';
        };
        vjClipLauncher.triggerClip(layerIndex, columnIndex, safeBank(bank));
        break;
      }

      case 'trigger_vj_column': {
        const { columnIndex, bank } = (msg as unknown) as { columnIndex: number; bank?: 'A' | 'B' };
        vjClipLauncher.triggerColumn(columnIndex, safeBank(bank));
        break;
      }

      case 'stop_vj_layer': {
        const { layerIndex, bank } = (msg as unknown) as { layerIndex: number; bank?: 'A' | 'B' };
        vjClipLauncher.stopLayer(layerIndex, safeBank(bank));
        break;
      }

      case 'stop_all_vj': {
        // Mobile stopped all VJ clips (sweeps both banks — store handles it)
        vjClipLauncher.stopAll();
        break;
      }

      case 'set_vj_block': {
        // Mobile switched VJ block — both banks flip together (store handles per-block A+B)
        const { blockId } = (msg as unknown) as { blockId: string };
        vjClipLauncher.setActiveBlock(blockId);
        break;
      }

      case 'set_vj_live': {
        // Mobile toggled VJ live mode
        const { isLive } = (msg as unknown) as { isLive: boolean };
        vjClipLauncher.setLive(isLive);
        break;
      }

      case 'set_vj_layer_opacity': {
        const { layerIndex, opacity, bank } = (msg as unknown) as { layerIndex: number; opacity: number; bank?: 'A' | 'B' };
        const clamped = Math.max(0, Math.min(1, Number(opacity) || 0));
        vjClipLauncher.setLayerOpacity(layerIndex, clamped, safeBank(bank));
        break;
      }

      case 'set_vj_layer_blend_mode': {
        const { layerIndex, blendMode, bank } = (msg as unknown) as { layerIndex: number; blendMode: string; bank?: 'A' | 'B' };
        vjClipLauncher.setLayerBlendMode(layerIndex, blendMode as import('./lib/types').BlendMode, safeBank(bank));
        break;
      }

      case 'toggle_vj_layer_solo': {
        const { layerIndex, bank } = (msg as unknown) as { layerIndex: number; bank?: 'A' | 'B' };
        vjClipLauncher.toggleLayerSolo(layerIndex, safeBank(bank));
        break;
      }

      case 'toggle_vj_layer_mute': {
        const { layerIndex, bank } = (msg as unknown) as { layerIndex: number; bank?: 'A' | 'B' };
        vjClipLauncher.toggleLayerMute(layerIndex, safeBank(bank));
        break;
      }

      case 'set_vj_master_opacity': {
        // Mobile adjusted VJ master opacity
        const { opacity } = (msg as unknown) as { opacity: number };
        vjClipLauncher.setMasterOpacity(opacity);
        break;
      }

      // ===== Crossfader (new mobile messages) =====
      // All crossfader/quantize/macro/snapshot handlers validate their
      // payloads at the WS boundary. Mobile is generally trusted but
      // a hostile LAN client (or malformed message after a network
      // glitch) shouldn't be able to push out-of-range/garbage values
      // through to the stores. Whitelist enums and clamp numbers.
      case 'set_vj_crossfader_enabled': {
        const { enabled } = (msg as unknown) as { enabled: boolean };
        vjClipLauncher.setCrossfaderEnabled(!!enabled);
        break;
      }
      case 'set_vj_crossfader_value': {
        const { value } = (msg as unknown) as { value: number };
        const clamped = Math.max(0, Math.min(1, Number(value) || 0));
        vjClipLauncher.setCrossfaderValue(clamped);
        break;
      }
      case 'set_vj_crossfader_transition': {
        const { transition } = (msg as unknown) as { transition: string };
        // Whitelist MUST match the CrossfaderTransition union in
        // vjClipLauncher.ts. Earlier this carried stale strings
        // ('cut', 'wipe-left', 'fade-black', etc.) from a v1 mobile
        // surface that never shipped — anything the iPad's transition
        // dropdown sent (glitch, shatter, liquid, etc.) was silently
        // rejected here and the store stayed on the prior transition,
        // making the iPad dropdown appear to do nothing but dissolve.
        const allowed = ['dissolve', 'wipe', 'rgb-split', 'cube', 'shatter', 'halftone', 'glitch', 'liquid', 'strobe', 'slide'];
        if (allowed.includes(transition)) {
          vjClipLauncher.setCrossfaderTransition(transition as any);
        }
        break;
      }
      case 'set_vj_crossfader_curve': {
        const { curve } = (msg as unknown) as { curve: string };
        const allowed = ['linear', 'constant-power', 'sharp-cut'];
        if (allowed.includes(curve)) {
          vjClipLauncher.setCrossfaderCurve(curve as any);
        }
        break;
      }
      case 'set_vj_crossfader_blend_mode': {
        const { blendMode } = (msg as unknown) as { blendMode: string };
        const allowed = ['normal','multiply','screen','add','difference','darken','lighten','overlay','exclusion'];
        if (allowed.includes(blendMode)) {
          vjClipLauncher.setCrossfaderBlendMode(blendMode as any);
        }
        break;
      }
      case 'vj_cut_to_a': { vjClipLauncher.cutToA(); break; }
      case 'vj_cut_to_b': { vjClipLauncher.cutToB(); break; }

      // ===== Quantization (new) =====
      case 'set_vj_quantization': {
        const { grid } = (msg as unknown) as { grid: string };
        const allowed = ['off', '1/16', '1/8', '1/4', '1/2', '1', '2', '4', '8', '1bar', '2bar', '4bar'];
        if (allowed.includes(grid)) {
          vjClipLauncher.setQuantization(grid as any);
        }
        break;
      }
      case 'clear_vj_pending_triggers': {
        vjClipLauncher.clearPendingTriggers();
        break;
      }

      // ===== Macros (new) =====
      case 'set_vj_macro_value': {
        const { macroId, value } = (msg as unknown) as { macroId: string; value: number };
        if (typeof macroId === 'string' && macroId.length > 0) {
          const clamped = Math.max(0, Math.min(1, Number(value) || 0));
          macros.setMacroValue(macroId, clamped);
        }
        break;
      }

      // ===== Snapshots (new) =====
      case 'recall_vj_snapshot': {
        const { index } = (msg as unknown) as { index: number };
        if (Number.isInteger(index) && index >= 0 && index < 16) {
          snapshotsStore.recall(index);
        }
        break;
      }
      case 'save_vj_snapshot': {
        // Mobile request to save current state to a slot. Useful for tablet
        // performers who want to capture without reaching for the desktop.
        const { index, name } = (msg as unknown) as { index: number; name?: string };
        if (Number.isInteger(index) && index >= 0 && index < 16) {
          // name is user-input; clamp length to match desktop's 18-char rename limit.
          const safeName = typeof name === 'string' ? name.slice(0, 18) : undefined;
          snapshotsStore.save(index, safeName);
        }
        break;
      }

      // ===== Tap tempo (new) =====
      case 'vj_tap_tempo': {
        audioStore.tapTempo();
        break;
      }
      case 'vj_clear_manual_bpm': {
        audioStore.clearManualBPM();
        break;
      }

      case 'load_composition': {
        // Mobile loaded a composition/preset
        const { compositionId } = (msg as unknown) as { compositionId: string };
        project.loadComposition(compositionId);
        break;
      }

      case 'set_output_freeze': {
        // Mobile pressed the pause/play pill. Reuse the exact same path
        // the desktop's freeze button takes — set the store + broadcast
        // to the output window — so the behaviour is identical whether
        // you trigger it from desktop, B-key, or phone.
        const want = !!(msg as { frozen?: boolean }).frozen;
        const cur = get(outputFrozen);
        console.log(`[Mobile freeze] received set_output_freeze frozen=${want} (cur=${cur})`);
        if (cur !== want) {
          // toggleFreeze() is the canonical desktop path — it does the
          // store update + the BroadcastChannel ping to the output window
          // in one place. Calling it directly keeps mobile in lockstep
          // with whatever toggleFreeze grows to do in the future.
          toggleFreeze();
        }
        break;
      }

      case 'add_vj_layer_effect': {
        // Mobile added an effect to a VJ layer
        const { layerIndex, effect } = (msg as unknown) as { layerIndex: number; effect: import('./lib/types').Effect };
        vjClipLauncher.addLayerEffect(layerIndex, effect);
        break;
      }

      case 'remove_vj_layer_effect': {
        // Mobile removed an effect from a VJ layer
        const { layerIndex, effectId } = (msg as unknown) as { layerIndex: number; effectId: string };
        vjClipLauncher.removeLayerEffect(layerIndex, effectId);
        break;
      }

      case 'toggle_vj_layer_effect': {
        // Mobile toggled an effect on a VJ layer
        const { layerIndex, effectId } = (msg as unknown) as { layerIndex: number; effectId: string };
        vjClipLauncher.toggleLayerEffect(layerIndex, effectId);
        break;
      }

      case 'update_vj_layer_effect_params': {
        // Mobile updated effect parameters on a VJ layer
        const { layerIndex, effectId, params } = (msg as unknown) as {
          layerIndex: number;
          effectId: string;
          params: Partial<import('./lib/types').EffectParams>;
        };
        vjClipLauncher.updateLayerEffectParams(layerIndex, effectId, params);
        break;
      }

      case 'update_vj_shader_value': {
        // Mobile updated a shader parameter value on an active clip
        const { layerIndex, paramName, value } = (msg as unknown) as {
          layerIndex: number;
          paramName: string;
          value: any;
        };
        vjClipLauncher.updateActiveClipShaderValue(layerIndex, paramName, value);
        break;
      }

      // ═══ Composition effect messages from mobile ═══
      case 'add_vj_comp_effect': {
        const { effect } = (msg as unknown) as { effect: import('./lib/types').Effect };
        vjClipLauncher.addCompositionEffect(effect);
        break;
      }

      case 'remove_vj_comp_effect': {
        const { effectId } = (msg as unknown) as { effectId: string };
        vjClipLauncher.removeCompositionEffect(effectId);
        break;
      }

      case 'toggle_vj_comp_effect': {
        const { effectId } = (msg as unknown) as { effectId: string };
        vjClipLauncher.toggleCompositionEffect(effectId);
        break;
      }

      case 'update_vj_comp_effect_params': {
        const { effectId, params } = (msg as unknown) as {
          effectId: string;
          params: Record<string, any>;
        };
        vjClipLauncher.updateCompositionEffectParams(effectId, params);
        break;
      }

      // ═══ Clip effect messages from mobile ═══
      case 'add_vj_clip_effect': {
        const { layerIndex, columnIndex, effect } = (msg as unknown) as {
          layerIndex: number;
          columnIndex: number;
          effect: import('./lib/types').Effect;
        };
        vjClipLauncher.addClipEffect(layerIndex, columnIndex, effect);
        break;
      }

      case 'remove_vj_clip_effect': {
        const { layerIndex, columnIndex, effectId } = (msg as unknown) as {
          layerIndex: number;
          columnIndex: number;
          effectId: string;
        };
        vjClipLauncher.removeClipEffect(layerIndex, columnIndex, effectId);
        break;
      }

      case 'toggle_vj_clip_effect': {
        const { layerIndex, columnIndex, effectId } = (msg as unknown) as {
          layerIndex: number;
          columnIndex: number;
          effectId: string;
        };
        vjClipLauncher.toggleClipEffect(layerIndex, columnIndex, effectId);
        break;
      }

      case 'update_vj_clip_effect_params': {
        const { layerIndex, columnIndex, effectId, params } = (msg as unknown) as {
          layerIndex: number;
          columnIndex: number;
          effectId: string;
          params: Record<string, any>;
        };
        vjClipLauncher.updateClipEffectParams(layerIndex, columnIndex, effectId, params);
        break;
      }

      // ── Light painting from mobile (iPad Apple Pencil) ──
      case 'lightpainting_hover': {
        const { x, y } = msg as any;
        import('./lib/sync/stateBroadcast').then(m => m.broadcastCursorPosition(x, y));
        break;
      }
      case 'lightpainting_stroke_start': {
        const { layerId, brush } = msg as any;
        (window as any).__mobileLPState = {
          layerId,
          brush,
          points: [],
          startTime: performance.now(),
          previewRafId: null,
          lastPreviewSyncTime: 0,
        };
        project.updateLightPaintingContent(layerId, { isRecording: true });
        break;
      }
      case 'lightpainting_stroke_point': {
        const state = (window as any).__mobileLPState;
        if (!state) break;
        const { x, y, pressure, timestamp } = msg as any;
        state.points.push({ x, y, pressure: pressure ?? 0.5, timestamp: timestamp ?? (performance.now() - state.startTime) });
        scheduleMobileLightPaintingPreview(state);
        break;
      }
      case 'lightpainting_stroke_end': {
        const state = (window as any).__mobileLPState;
        if (!state || state.points.length < 2) {
          cancelMobileLightPaintingPreview(state);
          if (state?.layerId) project.updateLightPaintingContent(state.layerId, { isRecording: false, livePreviewStroke: null });
          (window as any).__mobileLPState = null;
          break;
        }
        cancelMobileLightPaintingPreview(state);
        // Finalize stroke with smoothing
        let finalPoints = [...state.points];
        const smoothing = state.brush.smoothing ?? 0.5;
        // Simple Chaikin smoothing inline (same algorithm as LightPaintingPanel)
        const passes = Math.ceil(smoothing * 3);
        for (let p = 0; p < passes; p++) {
          const smoothed: typeof finalPoints = [];
          for (let i = 0; i < finalPoints.length - 1; i++) {
            const a = finalPoints[i], b = finalPoints[i + 1];
            smoothed.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, pressure: a.pressure, timestamp: a.timestamp });
            smoothed.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, pressure: b.pressure, timestamp: b.timestamp });
          }
          finalPoints = smoothed;
        }
        // Cap at 800 points
        if (finalPoints.length > 800) {
          const step = finalPoints.length / 800;
          const resampled: typeof finalPoints = [];
          for (let i = 0; i < 800; i++) resampled.push(finalPoints[Math.floor(i * step)]);
          finalPoints = resampled;
        }
        project.addLightPaintingStroke(state.layerId, {
          id: generateUUID(),
          points: finalPoints,
          brush: state.brush,
          duration: performance.now() - state.startTime,
          visible: true,
          locked: false,
          drawMode: 'freehand',
        });
        project.updateLightPaintingContent(state.layerId, { isRecording: false, livePreviewStroke: null });
        (window as any).__mobileLPState = null;
        // Clear cursor from output
        import('./lib/sync/stateBroadcast').then(m => m.broadcastCursorClear());
        break;
      }
    }
  }

  // Sync project state to server.  We sanitize before JSON.stringify to
  // strip runtime objects that the renderer attaches to layer / clip
  // structures at draw time (THREE textures, WebGL render targets, DOM
  // canvases, video elements, internal `_*` caches). Any one of those
  // can introduce a circular structure that aborts the serialization
  // for the entire frame — which then freezes the reactive graph
  // because the effect throws on every tick. Strip them here once and
  // the mobile companion still gets the data it actually needs (ids,
  // names, params, layouts).
  const _SKIP_KEYS = new Set(['texture', 'videoElement', 'iframeElement', 'renderTarget', 'synthVisionCanvas', 'threejsCanvas']);
  function _sanitizeForSync(key: string, value: any): any {
    if (_SKIP_KEYS.has(key)) return undefined;
    if (typeof key === 'string' && key.startsWith('_')) return undefined;
    if (value && typeof value === 'object') {
      const ctor = (value as any).constructor?.name;
      // THREE objects + DOM elements — strip on identity rather than key.
      if ((value as any).isTexture) return undefined;
      if ((value as any).isWebGLRenderTarget) return undefined;
      if ((value as any).isMesh || (value as any).isObject3D) return undefined;
      if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return undefined;
      if (ctor && ctor.startsWith('_')) return undefined;
    }
    return value;
  }
  function syncState() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'sync',
          project: $project,
        }, _sanitizeForSync));
      } catch (err) {
        // Belt-and-suspenders: even with the replacer, an exotic
        // circular structure could slip through. Don't let it brick
        // the reactive graph.
        console.error('[syncState] serialize failed, skipping frame:', err);
      }
    }
  }

  // Cache of converted image data URLs keyed by source blob: URL.
  // Image library items use their own blob: URL as the thumbnail value
  // (the thumbnail _is_ the source image), but blob URLs are scoped to
  // the desktop window — sending one to mobile yields a broken <img>.
  // We rasterize each blob: thumbnail to a small JPEG data URL once and
  // reuse that data URL for every subsequent sync. Cache survives until
  // the desktop reload (no eviction needed; thumbnails are tiny).
  const _imageThumbCache = new Map<string, string>();
  async function ensureImageDataUrl(blobUrl: string): Promise<string | undefined> {
    if (!blobUrl?.startsWith('blob:')) return undefined;
    const cached = _imageThumbCache.get(blobUrl);
    if (cached) return cached;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = blobUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
      });
      const c = document.createElement('canvas');
      const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      c.width = 160;
      c.height = Math.max(1, Math.round(160 / Math.max(ratio, 0.1)));
      const ctx = c.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.7);
      _imageThumbCache.set(blobUrl, data);
      return data;
    } catch {
      return undefined;
    }
  }

  // Sync media library to mobile (videos and images only — serializable data).
  // Async because image thumbnails (which start life as blob: URLs from drag-
  // drop / file-picker) need to be rasterized to portable data: URLs before
  // the mobile can render them. Video thumbnails are already data URLs from
  // captureVideoThumbnail, so they pass through unchanged.
  async function syncMediaLibrary() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const items = $mediaLibrary;
    const out = await Promise.all(items.map(async (item) => {
      let thumb = item.thumbnail || '';
      if (thumb.startsWith('blob:')) {
        const data = await ensureImageDataUrl(thumb);
        if (data) thumb = data;
        else thumb = '';
      }
      return {
        id: item.id,
        name: item.name,
        src: item.src,
        type: item.type,
        thumbnail: thumb,
      };
    }));
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'library_sync',
      library: out,
    }));
  }

  // Sync on project changes
  $: if (wsServerReady && $project) {
    syncState();
  }

  // Sync media library when it changes
  $: if (wsServerReady && $mediaLibrary) {
    syncMediaLibrary();
  }

  // Push the current output-freeze state to mobile every time it changes
  // (so the phone's pause/play pill stays in sync with the desktop's
  // freeze button + B-key shortcut + any other connected mobile peer).
  function syncOutputFreeze(frozen: boolean) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output_freeze_state', frozen }));
    }
  }
  $: if (wsServerReady) syncOutputFreeze($outputFrozen);

  // Sync the MediaTray's canonical shader list to mobile. This is the
  // EXACT same list the desktop user picks from (manifest catalog +
  // user-added + AI generated + cloud-synced), with the same thumbnails
  // already rendered for the desktop tiles. Mobile uses this as its
  // sole source of truth — no separate manifest fetch — so any
  // add/remove on desktop appears on the phone within one render frame.
  // The store is published by MediaTray.svelte's reactive `$:` block
  // and survives MediaTray remounts because it lives at module scope.
  function syncShaderLibrary(list: Array<{
    id: string;
    name: string;
    src: string;
    thumbnail?: string;
    custom?: boolean;
  }>) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'shader_library_sync', shaders: list }));
  }
  $: if (wsServerReady) syncShaderLibrary($mediaTrayShaders);

  // Sync VJ Clip Launcher state to mobile (clips in the grid)
  function syncVJClips() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Common per-clip serializer used for both Bank A grid and Bank B grid.
      const serializeClip = (clip: any) => clip ? {
        id: clip.id,
        type: clip.type,
        name: clip.name,
        src: clip.src,
        thumbnail: clip.thumbnail,
        shaderCode: clip.shaderCode,
        effects: clip.effects || [],
      } : null;
      const serializeLayerState = (ls: any) => ({
        opacity: ls.opacity,
        blendMode: ls.blendMode,
        activeColumn: ls.activeColumn,
        activeClip: ls.activeClip ? {
          id: ls.activeClip.id,
          type: ls.activeClip.type,
          name: ls.activeClip.name,
          src: ls.activeClip.src,
          thumbnail: ls.activeClip.thumbnail,
          shaderCode: ls.activeClip.shaderCode,
          shaderValues: ls.activeClip.shaderValues,
        } : null,
        solo: ls.solo,
        mute: ls.mute,
        effects: ls.effects || [],
      });

      // Send serializable VJ clip data (strip runtime objects). Now includes
      // every new feature surface so the mobile companion can render the
      // dual decks, crossfader, macros, snapshots, and quantize grid
      // alongside the original clip-grid + mixer + master controls.
      const serializableClips = {
        blocks: $vjClipLauncher.blocks.map(block => ({
          id: block.id,
          name: block.name,
          clipGrid: block.clipGrid.map(row => row.map(serializeClip)),
          // Per-block Bank B grid — new in v0.3.x. Switching blocks on
          // mobile flips both decks together (matching desktop behavior).
          bankBClipGrid: (block.bankBClipGrid || []).map(row => row.map(serializeClip)),
        })),
        activeBlockId: $vjClipLauncher.activeBlockId,
        layerStates: $vjClipLauncher.layerStates.map(serializeLayerState),
        // Bank B per-layer state (independent of Bank A — opacity / blend /
        // solo / mute / activeClip all distinct per deck).
        bankBLayerStates: $vjClipLauncher.bankBLayerStates.map(serializeLayerState),
        isLive: $vjClipLauncher.isLive,
        masterOpacity: $vjClipLauncher.masterOpacity,
        compositionEffects: $vjClipLauncher.compositionEffects || [],
        // ===== Crossfader =====
        crossfaderEnabled: $vjClipLauncher.crossfaderEnabled,
        crossfaderValue: $vjClipLauncher.crossfaderValue,
        crossfaderTransition: $vjClipLauncher.crossfaderTransition,
        crossfaderCurve: $vjClipLauncher.crossfaderCurve,
        crossfaderBlendMode: $vjClipLauncher.crossfaderBlendMode,
        selectedDeck: $vjClipLauncher.selectedDeck,
        // ===== Quantization =====
        quantization: $vjClipLauncher.quantization,
        pendingTriggerCount: $vjClipLauncher.pendingTriggers.length,
        // ===== Macros (8 knobs — values + names + colors + effect counts) =====
        // v2 macros: each macro is an effect bundle with a wet/dry knob.
        // The mobile surface only needs the metadata needed to render
        // the knob; the bundle itself stays on the desktop.
        macros: $macros.macros.map(m => ({
          id: m.id,
          name: m.name,
          color: m.color,
          value: m.value,
          destCount: m.effects.length,  // re-purposed: now effect count for the badge
          pulseMode: m.pulseMode,
        })),
        // ===== Snapshots (16 slots — minimal metadata, just enough to render the bank) =====
        snapshots: $snapshotsStore.snapshots.map(s => ({
          id: s.id,
          slot: s.slot,
          name: s.name,
          color: s.color,
          populated: s.capturedAt > 0,
        })),
        activeSnapshotId: $snapshotsStore.activeId,
        // ===== Tempo / audio readout =====
        // `beat` deliberately omitted — it's a 10ms momentary flag at
        // 120 BPM and would never reliably catch the up-edge through
        // the throttled sync. See `beat_pulse` channel emitted from
        // the audio analyzer's beat callback below.
        bpm: $audioStore.bpm,
        manualBPM: $audioStore.manualBPM,
      };
      ws.send(JSON.stringify({
        type: 'vj_clips_sync',
        vjClips: serializableClips,
      }));
    }
  }

  // Sync compositions/presets to mobile
  function syncCompositions() {
    if (ws && ws.readyState === WebSocket.OPEN && $project.vjMode) {
      // Send only essential composition data (id, name, thumbnail)
      const serializableCompositions = $project.vjMode.compositions.map(comp => ({
        id: comp.id,
        name: comp.name,
        thumbnail: comp.thumbnail,
      }));
      ws.send(JSON.stringify({
        type: 'compositions_sync',
        compositions: serializableCompositions,
      }));
    }
  }

  // ─── Mobile state-sync (throttled) ──────────────────────────────────
  // Beat-pulsed macros and crossfader sweeps can mutate the launcher /
  // macro stores at rAF frequency (~60Hz). The serialized payload is
  // 30-50KB (Bank A grid + Bank B grid + N layers + 8 macros + 16
  // snapshots + audio). Without a throttle the WS socket
  // would queue ~480 sync messages per second during a heavy show.
  // Trailing-edge timer at 33ms matches the mobile sender throttle so
  // there's symmetric pressure on both sides of the wire.
  let syncVJClipsPending = false;
  let syncVJClipsTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSyncVJClips() {
    if (!wsServerReady) return;
    if (syncVJClipsTimer) {
      syncVJClipsPending = true;
      return;
    }
    syncVJClips();
    syncVJClipsTimer = setTimeout(() => {
      syncVJClipsTimer = null;
      if (syncVJClipsPending) {
        syncVJClipsPending = false;
        scheduleSyncVJClips();
      }
    }, 33);
  }

  // Sync VJ clips when they change. We watch every store whose state
  // ends up in the serialized payload — `$vjClipLauncher` covers the
  // grids + decks, but macros / snapshots / audio each have
  // their own store and Svelte's reactive system only tracks the
  // identifiers it actually sees in the `if (...)` expression.
  // (CRITICAL fix v17.1: prior version only watched vjClipLauncher,
  // so dragging a macro on desktop never reached mobile.)
  $: if (wsServerReady && $vjClipLauncher) {
    scheduleSyncVJClips();
  }
  $: if (wsServerReady && $macros) {
    scheduleSyncVJClips();
  }
  $: if (wsServerReady && $snapshotsStore) {
    scheduleSyncVJClips();
  }
  // Audio: BPM / manualBPM only (NOT beat — that's emitted via the
  // dedicated beat_pulse channel because it's a 10ms momentary flag).
  $: if (wsServerReady && ($audioStore.bpm || $audioStore.manualBPM)) {
    scheduleSyncVJClips();
  }

  // ── Beat pulse (separate channel) ────────────────────────────────
  // Detect rising edges of $audioStore.beat.isBeat and fire a tiny
  // dedicated WS message. Mobile UI listens for `beat_pulse` to
  // momentarily flash the TAP button + BPM number. This bypasses the
  // syncVJClips throttle so beats stay tight (within one rAF frame).
  let lastBeatFlag = false;
  $: if (wsServerReady && ws && ws.readyState === WebSocket.OPEN) {
    const now = !!$audioStore.beat?.isBeat;
    if (now && !lastBeatFlag) {
      try {
        ws.send(JSON.stringify({
          type: 'beat_pulse',
          intensity: $audioStore.beat?.beatIntensity ?? 1,
          count: $audioStore.beat?.beatCount ?? 0,
        }));
      } catch { /* socket may have closed mid-send */ }
    }
    lastBeatFlag = now;
  }

  // Sync compositions when project vjMode changes
  $: if (wsServerReady && $project.vjMode?.compositions) {
    syncCompositions();
  }

  // Output window state
  let outputMode: 'embedded' | 'window' | 'fullscreen' = 'embedded';

  function openOutputWindow() {
    outputMode = 'window';
    if (outputWindow) {
      outputWindow.openPopup();
      outputIsOpen = true;
      settings.setOutputWindowOpen(true);
    }
  }

  function closeOutputWindow() {
    if (outputWindow) {
      outputWindow.close();
    }
    outputIsOpen = false;
    outputMode = 'embedded';
    settings.setOutputWindowOpen(false);
  }

  async function matchOutputDisplayResolution(reason: string) {
    if (!isDesktopApp) return;
    try {
      const info: any = await invoke('get_output_display_info');
      if (!info?.nativeWidth || !info?.nativeHeight) return;
      const current = get(project);
      if (current.width === info.nativeWidth && current.height === info.nativeHeight) return;
      console.log(`[Output] Matching project resolution for ${reason}: ${current.width}x${current.height} -> ${info.nativeWidth}x${info.nativeHeight} (${info.label || 'display'})`);
      project.setProjectDimensions(info.nativeWidth, info.nativeHeight);
    } catch (err) {
      console.warn('[Output] Could not match output display resolution:', err);
    }
  }

  async function toggleFullscreen() {
    // If output window is already open, toggle its fullscreen
    if (outputIsOpen && outputWindow) {
      await matchOutputDisplayResolution('fullscreen output');
      const isFs = await outputWindow.toggleFullscreen();
      outputMode = isFs ? 'fullscreen' : 'window';
      return;
    }

    // Open fullscreen output on external monitor (or primary if no external)
    if (outputMode !== 'fullscreen') {
      if (outputWindow) {
        await matchOutputDisplayResolution('fullscreen output');
        await outputWindow.openFullscreenExternal();
        outputIsOpen = true;
        outputMode = 'fullscreen';
        settings.setOutputWindowOpen(true);
      }
    } else {
      // Close the fullscreen output
      if (outputWindow) {
        outputWindow.close();
      }
      outputIsOpen = false;
      outputMode = 'embedded';
      settings.setOutputWindowOpen(false);
    }
  }

  // Show mobile connection info
  let showMobileInfo = false;
  let localIPs: string[] = [];
  let qrCodeDataUrl: string = '';
  let selectedIP: string = '';

  // Detect local IP addresses - tries server first, then WebRTC fallback
  async function fetchLocalIPs() {
    const ips: string[] = [];

    // If we're already accessing via a network IP, use that first
    const currentHost = window.location.hostname;
    if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
      ips.push(currentHost);
    }

    // Method 1: Ask the WebSocket server for IPs (most reliable)
    // The server uses Node's os.networkInterfaces() which is accurate
    try {
      const response = await fetch(`http://localhost:${httpPort}/info`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ips && Array.isArray(data.ips)) {
          data.ips.forEach((ip: string) => {
            if (!ips.includes(ip) && ip !== '127.0.0.1' && !ip.startsWith('169.254.')) {
              ips.push(ip);
            }
          });
        }
      }
    } catch (err) {
      console.log('Server IP fetch failed, trying WebRTC:', err);
    }

    // Method 2: Try to detect local IP via WebRTC (fallback)
    if (ips.length === 0) {
      try {
        const rtc = new RTCPeerConnection({ iceServers: [] });
        rtc.createDataChannel('');

        const localIPPromise = new Promise<string[]>((resolve) => {
          const foundIPs: string[] = [];
          setTimeout(() => {
            rtc.close();
            resolve(foundIPs);
          }, 1000);

          rtc.onicecandidate = (e) => {
            if (!e.candidate) return;
            const match = e.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
            if (match) {
              const ip = match[0];
              // Filter out localhost and link-local addresses
              if (ip !== '127.0.0.1' && !ip.startsWith('169.254.') && !foundIPs.includes(ip)) {
                foundIPs.push(ip);
              }
            }
          };

          rtc.createOffer().then(offer => rtc.setLocalDescription(offer));
        });

        const detectedIPs = await localIPPromise;
        detectedIPs.forEach(ip => {
          if (!ips.includes(ip)) ips.push(ip);
        });
      } catch (err) {
        console.log('WebRTC IP detection not available:', err);
      }
    }

    // Never fall back to localhost - that won't work for mobile devices
    // If no IPs found, show a helpful message
    if (ips.length === 0) {
      console.warn('Could not detect network IP. Make sure you are connected to a network.');
    }

    localIPs = ips;
    if (localIPs.length > 0 && !selectedIP) {
      selectedIP = localIPs[0];
    }
  }

  function getMobileUrl(ip?: string) {
    const host = ip || selectedIP || localIPs[0] || window.location.hostname;
    // In production: serve from the HTTP server on port 9002 (accessible over LAN)
    // In dev: use Vite dev server on port 1420
    const isDev = window.location.protocol !== 'file:' && window.location.port === '1420';
    const port = isDev ? 1420 : 9002;
    return `http://${host}:${port}/#/mobile`;
  }

  function getWebSocketUrl(ip?: string) {
    const host = ip || selectedIP || localIPs[0] || window.location.hostname;
    return `ws://${host}:9001`;
  }

  // Generate QR code for the mobile URL
  async function generateQRCode() {
    if (!selectedIP && localIPs.length > 0) {
      selectedIP = localIPs[0];
    }
    const url = getMobileUrl(selectedIP);
    try {
      qrCodeDataUrl = await QRCode.toDataURL(url, {
        width: 200,
        margin: 2,
        color: {
          dark: '#67E8F9',
          light: '#1a1a1a'
        }
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }
  }

  // Regenerate QR when IP selection changes
  $: if (selectedIP && showMobileInfo) {
    generateQRCode();
  }

  // ============================================================================
  // SAVE / LOAD COMPOSITION
  // ============================================================================

  let fileInput: HTMLInputElement;
  // After the first successful native save, remember the directory so re-saves
  // materialize blobs to the same place.
  let currentProjectPath: string | null = null;
  // Re-entrance guard for save flows. Prevents Ctrl+S firing twice rapidly
  // (or menu-click + key-binding both hitting saveComposition) from popping
  // two native dialogs or queuing a second save against the file the first
  // one is still writing.
  let saveInFlight = false;

  /**
   * Walk a project JSON and ensure every media-bearing node carries a
   * resolvable identity in the saved file. The save NEVER copies files —
   * earlier versions did, and on top of being slow it polluted the user's
   * folders with `*_2.mp4` duplicates whenever the .gha lived in the same
   * directory as the source media. We just save the path.
   *
   * What actually happens:
   *   - Nodes with `_assetRef.originalPath`: leave the assetRef alone.
   *     Reload converts originalPath → ghost-asset:// URL via the resolver.
   *   - Nodes with `_assetRef.dataUrl` / `_assetRef.url`: same — pass through.
   *   - Legacy nodes with a raw `blob:` URL on the runtime field but no
   *     assetRef: nothing we can do — the blob dies at session end and we
   *     have no path to recover. Mark them by clearing the dead URL so
   *     the layer comes back as "missing media" instead of an unresolvable
   *     phantom. Users with old projects need to re-import the file once;
   *     the new import flow captures originalPath.
   *
   * Returns JSON unchanged if not running in Electron (browser builds rely
   * on whatever URL the renderer captured, since they have no disk paths).
   */
  async function materializeAssetsInProject(jsonStr: string, projectDir: string): Promise<string> {
    if (!isDesktopApp) return jsonStr;

    let data: any;
    try { data = JSON.parse(jsonStr); } catch { return jsonStr; }

    // Walk the project tree and clean up any runtime URLs we can't resolve
    // on reload. We do NOT copy any files. The user's folders are theirs;
    // the .gha just remembers paths.
    const BLOB_FIELDS = ['src', 'modelData', 'filePath', 'texturePath', 'sourceUrl', 'url', 'thumbnail'] as const;
    let kept = 0;        // assetRef-backed (originalPath, dataUrl, or url)
    let cleared = 0;     // blob: with no assetRef — runtime-only, can't recover

    function walk(node: any) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node !== 'object') return;

      // Tally assetRef-backed fields. Nothing to do — the resolver on
      // reload reads the assetRef to compute the runtime URL.
      if (node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl || node._assetRef?.url) kept++;
      if (node._textureAssetRef?.projectPath || node._textureAssetRef?.originalPath || node._textureAssetRef?.dataUrl || node._textureAssetRef?.url) kept++;
      if (node._sourceAssetRef?.projectPath || node._sourceAssetRef?.originalPath || node._sourceAssetRef?.dataUrl || node._sourceAssetRef?.url) kept++;
      if (node.assetRef?.projectPath || node.assetRef?.originalPath || node.assetRef?.dataUrl || node.assetRef?.url) kept++;

      // Strip dead blob: URLs from runtime fields when there's no AssetRef
      // to recover from. Keeping them in the saved file leads to the
      // dreaded "stale blob URL on reopen" bug — the renderer tries to
      // load `blob:http://localhost:1420/<gone>` and fails forever.
      for (const field of BLOB_FIELDS) {
        const v = node[field];
        if (typeof v !== 'string' || !v.startsWith('blob:')) continue;
        const hasRef =
          (field === 'src' && (node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl || node._assetRef?.url)) ||
          (field === 'modelData' && (node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl)) ||
          (field === 'filePath' && (node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl)) ||
          (field === 'texturePath' && (node._textureAssetRef?.projectPath || node._textureAssetRef?.originalPath || node._textureAssetRef?.dataUrl)) ||
          (field === 'sourceUrl' && (node._sourceAssetRef?.projectPath || node._sourceAssetRef?.originalPath || node._sourceAssetRef?.dataUrl)) ||
          (field === 'url' && (node.assetRef?.projectPath || node.assetRef?.originalPath || node.assetRef?.dataUrl || node.assetRef?.url || node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl || node._assetRef?.url)) ||
          (field === 'thumbnail' && (node._assetRef?.projectPath || node._assetRef?.originalPath || node._assetRef?.dataUrl || node._assetRef?.url));
        if (hasRef) {
          // The reload resolver will rebuild the URL from assetRef, so the
          // dead blob in the runtime field is harmless — but blank it out
          // anyway so JSON inspection isn't misleading.
          node[field] = '';
        } else {
          // No assetRef. Clear the dead URL so reload shows "missing
          // media" rather than retrying a blob:http://localhost/<gone>
          // forever. The user will have to re-import the file once.
          node[field] = '';
          cleared++;
        }
      }

      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('_')) continue;
        walk(v);
      }
    }
    walk(data);

    if (cleared > 0) {
      console.warn(
        `[Save] Cleared ${cleared} dead blob URL(s) — those layers had no ` +
        `originalPath captured (likely added before AssetRef wiring). ` +
        `Re-add the file in the layer to make it survive future save/reload.`,
      );
    }
    console.log(`[Save] Saved with ${kept} resolvable asset reference(s); no files copied.`);
    return JSON.stringify(data, null, 2);
  }
  // Back-compat alias — older code paths still call materializeBlobsInProject
  // by name. Kept thin so nothing else has to change.
  const materializeBlobsInProject = materializeAssetsInProject;

  // Save to existing file (or trigger Save As if no file).
  // Re-entrant guard: a fast double-press of Ctrl+S, or menu-click + key
  // overlap, used to fire two native dialogs back-to-back; the user reported
  // "saved and then immediately asked to save again, then dialog stopped
  // coming up". The mutex is the fix — second invocation no-ops while the
  // first is still in flight.
  async function saveComposition() {
    if (saveInFlight) {
      console.log('[Save] suppressed — save already in flight');
      return;
    }
    saveInFlight = true;
    fileMenuOpen = false;
    try {
      const jsonStr = await project.exportProjectJSONForSave();

      // Electron path: re-save to the previously-chosen filesystem path,
      // re-materializing any new blob assets to the same project dir.
      if (isDesktopApp && currentProjectPath) {
        const api = (window as any).electronAPI;
        if (api?.invoke) {
          try {
            const sep = currentProjectPath.includes('\\') ? '\\' : '/';
            const projectDir = currentProjectPath.substring(0, currentProjectPath.lastIndexOf(sep) + 1);
            const portableJson = await materializeAssetsInProject(jsonStr, projectDir);
            const result = await api.invoke('save_file_text', { path: currentProjectPath, content: portableJson });
            if (!result?.success) {
              alert(`Save failed: ${result?.error || 'unknown error'}`);
              return;
            }
            console.log('Project saved successfully:', currentProjectPath);
            // Bump to top of Recent Files and re-record with its path,
            // so clicking the entry later loads directly without the
            // file picker. Without this an in-place Electron save never
            // refreshes the recent-files entry.
            recentFiles.add(currentProjectPath.split(sep).pop() || 'project.gha', currentProjectPath);
            markAsSaved();
            clearAutosave();
            return;
          } catch (err: any) {
            // Don't fall through to Save As here — that pops a second dialog
            // for what was meant to be an in-place save and confused users
            // into a save loop. Surface the error instead.
            console.error('[Save] Electron save failed:', err);
            alert(`Save failed: ${err?.message || err}`);
            return;
          }
        }
      }

      // If we have a file handle, save directly to it
      if (currentFileHandle) {
        try {
          const writable = await currentFileHandle.createWritable();
          await writable.write(jsonStr);
          await writable.close();
          console.log('Project saved successfully');
          // currentProjectPath is non-null when this save originated
          // from a file we opened by absolute path (Electron picker /
          // recent-file click). Forwarding it makes the recent-files
          // entry directly loadable next time. Browser File System
          // Access handles don't expose a disk path → currentProjectPath
          // stays null in that case, which is the expected web behaviour.
          recentFiles.add(currentFileHandle.name, currentProjectPath);
          markAsSaved();
          clearAutosave();
          return;
        } catch (err: any) {
          console.warn('Failed to save to existing file, showing save dialog:', err);
        }
      }

      // No known target — trigger Save As. saveCompositionAs has its own
      // mutex check that becomes a no-op while saveInFlight is still true,
      // so we call its inner implementation directly to avoid the guard
      // bouncing this through.
      await saveCompositionAsInner();
    } finally {
      saveInFlight = false;
    }
  }

  // Save As — public entry point that takes the mutex.
  async function saveCompositionAs() {
    if (saveInFlight) {
      console.log('[Save] Save As suppressed — save already in flight');
      return;
    }
    saveInFlight = true;
    fileMenuOpen = false;
    try {
      await saveCompositionAsInner();
    } finally {
      saveInFlight = false;
    }
  }

  // The actual Save As work. Always shows a file picker. Caller owns the
  // mutex — split out so saveComposition can re-use it without lock thrash.
  async function saveCompositionAsInner() {
    const jsonStr = await project.exportProjectJSONForSave();
    const suggestedName = `${$project.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.gha`;

    // In Electron: use the native save dialog so we get a real filesystem
    // path, then materialize any blob: URLs into sibling files alongside the
    // .gha so the project is portable. Without this step, every video the
    // user dragged in saves as a session-only blob URL that can't be reopened
    // on another machine (or even the same machine after restart).
    if (isDesktopApp) {
      const api = (window as any).electronAPI;
      if (api?.invoke) {
        try {
          const dialogResult = await api.invoke('save_project_dialog', {
            defaultPath: suggestedName,
            title: 'Save Project As',
          });
          if (dialogResult?.canceled || !dialogResult?.filePath) return;
          const filePath: string = dialogResult.filePath;
          // Derive project dir from the chosen file path
          const sep = filePath.includes('\\') ? '\\' : '/';
          const projectDir = filePath.substring(0, filePath.lastIndexOf(sep) + 1);
          const portableJson = await materializeAssetsInProject(jsonStr, projectDir);
          const writeResult = await api.invoke('save_file_text', { path: filePath, content: portableJson });
          if (!writeResult?.success) {
            alert(`Save failed: ${writeResult?.error || 'unknown error'}`);
            return;
          }
          currentProjectPath = filePath;
          console.log('Project saved successfully (Electron native):', filePath);
          // Store the absolute path so clicking this entry in Recent
          // Files loads it directly instead of re-prompting the picker.
          recentFiles.add(filePath.split(sep).pop() || 'project.gha', filePath);
          markAsSaved();
          clearAutosave();
          return;
        } catch (err: any) {
          // In Electron, do NOT fall through to the browser File System
          // Access API — that pops a second native picker on top of the
          // failed one and explains the "two dialogs in a row" bug. Surface
          // the error and let the user retry.
          console.error('[Save As] Electron save failed:', err);
          alert(`Save failed: ${err?.message || err}`);
          return;
        }
      }
    }

    // Try to use the File System Access API for native save dialog
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: 'Ghost Arcade Project',
              accept: { 'application/json': ['.gha'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        currentFileHandle = handle; // Remember for future saves
        console.log('Project saved successfully');
        recentFiles.add(handle.name, null);
        markAsSaved();
        clearAutosave();
        return;
      } catch (err: any) {
        // User cancelled or API not supported
        if (err.name !== 'AbortError') {
          console.warn('File System Access API failed, falling back to download:', err);
        } else {
          // User cancelled, don't fall back
          return;
        }
      }
    }

    // Fallback to download method
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markAsSaved();
    clearAutosave();
  }

  function loadComposition() {
    fileMenuOpen = false;
    fileInput?.click();
  }

  function handleFileLoad(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Resolve the absolute disk path BEFORE the import runs so we can
    // pass it as projectDir. Without this, sibling-file references in
    // the .gha (the relative `./video.mp4` paths that
    // materializeBlobsInProject wrote at save-time) can't be resolved
    // and every media layer comes back with a dead `./filename` src
    // — looking like the saved-then-reopened project lost everything.
    //
    // Electron 32+ removed the non-standard `File.path` extension;
    // `webUtils.getPathForFile` is the official replacement. Returns
    // null in the web build or when the file came from a remote drop.
    const w = window as any;
    const electronPath: string | null = w.electronAPI?.getPathForFile?.(file) || null;
    let projectDir: string | undefined;
    if (electronPath) {
      const sep = electronPath.includes('\\') ? '\\' : '/';
      projectDir = electronPath.substring(0, electronPath.lastIndexOf(sep) + 1);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        // Clear stale performer / session / runtime caches before loading so
        // older project files can't carry legacy clip bindings into the new build.
        try { synthVisionStore.reset(); } catch {}
        try { sessionClipCache.clear(); } catch {}
        try { isfShaderCache.clear(); } catch {}
        try { modulationStore.clearAll(); } catch {}

        const success = project.importProjectJSON(content, projectDir);
        if (success) {
          console.log('Project loaded successfully', projectDir ? `(projectDir=${projectDir})` : '(no projectDir)');
          currentFileHandle = null; // Clear file handle since we loaded via file input
          // Track the loaded path so Save (Ctrl+S) overwrites the same .gha
          // file instead of triggering a Save As dialog.
          currentProjectPath = electronPath;
          recentFiles.add(file.name, electronPath);
          markAsSaved();
        } else {
          alert('Failed to load project. The file may be corrupted or invalid.');
        }
      }
    };
    reader.onerror = () => {
      alert('Failed to read the file.');
    };
    reader.readAsText(file);

    // Reset input so the same file can be loaded again
    input.value = '';
  }

  // Styled modal for the "New" file action — replaces the native confirm()
  // dialog so the prompt matches the rest of the in-app modals (close,
  // recovery) and shows below the menubar instead of as an OS-level alert.
  let showNewProjectModal = false;
  function newComposition() {
    fileMenuOpen = false;
    showNewProjectModal = true;
  }
  function newProjectConfirm() {
    showNewProjectModal = false;
    project.newProject('Untitled Project');
    vjClipLauncher.reset();
    synthVisionStore.reset();
    mediaLibrary.reset();
    modulationStore.clearAll();
    // Reset macros so the new project starts with empty 8 knobs instead
    // of inheriting the last project's destinations (would write to
    // layers that don't exist yet, looking like ghost-mappings).
    macros.reset();
    // Same for snapshots — fresh project, empty 16-slot bank.
    snapshots.reset();
    currentFileHandle = null; // Clear file handle for new project
    // Also clear the Electron path so Save doesn't accidentally overwrite
    // the previously-loaded .gha with a fresh empty project.
    currentProjectPath = null;
    history.clear();
    markAsSaved();
    clearAutosave();
  }
  function newProjectCancel() {
    showNewProjectModal = false;
  }

  // =========================================================================
  // OPEN RECENT FILE
  // =========================================================================
  async function openRecentFile(entry: { name: string; path: string | null; timestamp: number }) {
    fileMenuOpen = false;

    // Electron: read the file directly from disk via IPC
    if (isDesktopApp && entry.path) {
      try {
        const { invoke } = await import('$lib/bridge');
        const result = await invoke<{ content: string; dir: string }>('read_project_file', { path: entry.path });
        try { synthVisionStore.reset(); } catch {}
        try { sessionClipCache.clear(); } catch {}
        try { isfShaderCache.clear(); } catch {}
        try { modulationStore.clearAll(); } catch {}
        const success = project.importProjectJSON(result.content, result.dir);
        if (success) {
          console.log('Project loaded from recent:', entry.path);
          currentFileHandle = null;
          // Track the loaded path so Save updates this file in place.
          currentProjectPath = entry.path;
          recentFiles.add(entry.name, entry.path); // Bump to top
          markAsSaved();
          return;
        }
        alert('Failed to load project. The file may be corrupted or invalid.');
      } catch (err: any) {
        const missing = /not found|ENOENT/i.test(err?.message || '');
        if (missing) {
          if (confirm(`"${entry.name}" could not be found.\n\nRemove it from Recent Files?`)) {
            recentFiles.remove(entry);
          }
        } else {
          alert(`Failed to open recent file: ${err?.message || err}`);
        }
      }
      return;
    }

    // Web / no path: fall back to the file picker
    loadComposition();
  }

  // =========================================================================
  // EXPORT PRESETS TO FILE
  // =========================================================================
  async function exportPresetsToFile() {
    fileMenuOpen = false;
    const proj = get(project);
    const count = (proj.stagePresets?.length || 0) + (proj.svKeyboardPresets?.length || 0);
    if (count === 0) {
      alert('This project has no presets to export.');
      return;
    }

    const jsonStr = project.exportPresetsJSON();
    const suggestedName = `${proj.name.replace(/[^a-z0-9]/gi, '_')}_presets_${new Date().toISOString().split('T')[0]}.json`;

    // Prefer File System Access API for native save dialog
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Ghost Arcade Presets', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('File System Access API failed, falling back to download:', err);
      }
    }

    // Fallback to browser download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // IMPORT PRESETS FROM FILE
  // =========================================================================
  function importPresetsFromFile() {
    fileMenuOpen = false;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gha,.shrnk,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          const presets = project.importPresetsFromFile(data);
          if (!presets) {
            alert('No presets found in this file.');
            return;
          }
          const count = presets.stagePresets.length + presets.svKeyboardPresets.length;
          if (count === 0) {
            alert('No presets found in this file.');
            return;
          }
          if (confirm(`Import ${presets.stagePresets.length} stage preset(s) and ${presets.svKeyboardPresets.length} keyboard preset(s) into this project?`)) {
            project.mergeImportedPresets(presets);
          }
        } catch {
          alert('Failed to read presets from file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // =========================================================================
  // UNDO / REDO
  // =========================================================================
  // Initialize history with first project state
  let historyInitialized = false;
  $: if ($project && !historyInitialized) {
    history.init($project);
    historyInitialized = true;
  }

  // Record a snapshot — call this AFTER discrete user actions (warp end, layer add/delete, etc.)
  function recordHistory() {
    history.record(get(project));
  }

  // ─── Load Demo Project ───────────────────────────────────────────────
  let demoLoading = false;
  let demoProgress = 0;

  // First-launch demo auto-import.
  //
  // Triggers loadDemoProject() exactly once, on the first launch after install
  // (or after any state where 'ghostarcade-first-demo-imported' was cleared).
  // Marked-as-imported BEFORE the actual download so a network failure or user
  // cancel doesn't cause the auto-load to fire on every subsequent launch —
  // they can still trigger it manually from File → Load Demo Project.
  function maybeAutoLoadDemo() {
    if (!isDesktopApp) return;
    if (localStorage.getItem('ghostarcade-first-demo-imported')) return;
    localStorage.setItem('ghostarcade-first-demo-imported', new Date().toISOString());
    // Defer slightly so the welcome / EULA modal close animation finishes
    // and the user sees the app UI before the demo overlay takes over.
    // Pass silent=true so 404s / offline / network errors don't pop an alert
    // — user just lands on the blank composition.
    setTimeout(() => { loadDemoProject({ silent: true }); }, 400);
  }

  async function loadDemoProject(opts: { silent?: boolean } = {}) {
    const silent = opts.silent === true;
    fileMenuOpen = false;

    if (!isDesktopApp) {
      // Browser: redirect to website download
      window.open('https://ghostarcade.live/demo', '_blank');
      return;
    }

    demoLoading = true;
    demoProgress = 0;

    try {
      // Listen for download progress
      const progressHandler = (_event: any, data: { percent: number }) => {
        demoProgress = data.percent;
      };
      if ((window as any).electronAPI?.on) {
        (window as any).electronAPI.on('demo-download-progress', progressHandler);
      }

      console.log('[Demo] Downloading demo project...');

      const result = await invoke<{ projectDir: string; projectJSON: string; alreadyExists: boolean }>('download_demo_zip', {
        // Hosted on GitHub Releases (>100MB so can't live in shrinkwraplive's
        // public/ directly — GitHub repo file size limit). Stable URL, no
        // bandwidth charged to Vercel, served from GitHub's CDN.
        url: 'https://github.com/riskcapital/ghost-arcade-releases/releases/download/demo-assets/ghost-arcade-demo.zip',
      });

      if (result.alreadyExists) {
        console.log('[Demo] Demo already downloaded, loading...');
      }

      // Clear stale performer / session / runtime caches before loading so
      // older demo files can't carry legacy clip bindings into the new build.
      try { synthVisionStore.reset(); } catch {}
      try { sessionClipCache.clear(); } catch {}
      try { isfShaderCache.clear(); } catch {}
      try { modulationStore.clearAll(); } catch {}

      // Import the project with directory for relative path resolution
      const success = project.importProjectJSON(result.projectJSON, result.projectDir);

      if (success) {
        markAsSaved();
        console.log('[Demo] Demo project loaded successfully!');
      } else if (!silent) {
        alert('Failed to import demo project. The file may be corrupted.');
      }
    } catch (err: any) {
      console.error('[Demo] Failed to load demo project:', err);
      if (!silent) alert(`Demo download failed: ${err.message || err}`);
    } finally {
      demoLoading = false;
      demoProgress = 0;
    }
  }

  function handleUndo() {
    fileMenuOpen = false;
    history.suppress();
    const previousState = history.undo(get(project));
    if (previousState) {
      project.set(previousState);
    }
    history.unsuppress();
  }

  function handleRedo() {
    fileMenuOpen = false;
    history.suppress();
    const nextState = history.redo(get(project));
    if (nextState) {
      project.set(nextState);
    }
    history.unsuppress();
  }

  // Close file menu when clicking outside
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.file-menu-container')) {
      fileMenuOpen = false;
    }
  }

  // Shape drag state for lines layers
  let isDraggingShape = false;
  let dragStartPos: Point2D | null = null;
  let dragStartShapePos: Point2D | null = null;
  let draggedElementId: string | null = null;

  /**
   * Calculate the centroid of a polygon (array of vertices)
   */
  function getPolygonCentroid(vertices: Point2D[]): Point2D {
    if (vertices.length === 0) return { x: 0.5, y: 0.5 };
    let cx = 0, cy = 0;
    for (const v of vertices) {
      cx += v.x;
      cy += v.y;
    }
    return { x: cx / vertices.length, y: cy / vertices.length };
  }

  /**
   * Check if a point is inside or near a polygon
   */
  function pointNearPolygon(px: number, py: number, vertices: Point2D[], margin: number = 0.05): boolean {
    if (vertices.length < 2) return false;

    // First check bounding box with margin for quick rejection
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    // If outside bounding box + margin, quick reject
    if (px < minX - margin || px > maxX + margin || py < minY - margin || py > maxY + margin) {
      return false;
    }

    // Check if point is inside polygon using ray casting
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;

      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    if (inside) return true;

    // Check distance to edges
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];

      // Distance to line segment
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;

      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      const projX = a.x + t * dx;
      const projY = a.y + t * dy;
      const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);

      if (dist < margin) return true;
    }

    // Also check distance to vertices themselves
    for (const v of vertices) {
      const dist = Math.sqrt((px - v.x) ** 2 + (py - v.y) ** 2);
      if (dist < margin) return true;
    }

    return false;
  }

  function handleShapeClick(e: MouseEvent) {
    if (!$selectedLinesLayer?.linesContent) return;

    const { x: clickX, y: clickY } = mouseToCanvasCoords(e);

    // Find element at click position (reverse order to get top-most first)
    const elements = [...$selectedLinesLayer.linesContent.elements].reverse();
    for (const element of elements) {
      // Lines always have points — use polygon hit testing
      if (element.shape.points.length >= 2 && pointNearPolygon(clickX, clickY, element.shape.points)) {
        // Reset warp mode when selecting a different element
        if ($selectedLinesLayer.linesContent?.selectedElementId !== element.id) {
          warpModeEnabled = false;
        }
        project.selectElement($selectedLinesLayer.id, element.id);
        isDraggingShape = true;
        dragStartPos = { x: clickX, y: clickY };
        dragStartShapePos = getPolygonCentroid(element.shape.points);
        draggedElementId = element.id;
        return;
      }
    }

    // Clicked on empty space - deselect and exit warp mode
    warpModeEnabled = false;
    project.selectElement($selectedLinesLayer.id, null);
  }

  // Store original vertices when starting drag of custom vertex shape
  let dragStartCustomVertices: Point2D[] | null = null;

  function handleShapeDrag(e: MouseEvent) {
    if (!isDraggingShape || !dragStartPos || !dragStartShapePos || !draggedElementId) return;
    if (!$selectedLinesLayer) return;

    const { x: currentX, y: currentY } = mouseToCanvasCoords(e);

    const dx = currentX - dragStartPos.x;
    const dy = currentY - dragStartPos.y;

    // Find the element being dragged
    const element = $selectedLinesLayer.linesContent?.elements.find(
      el => el.id === draggedElementId
    );
    if (!element) return;

    // Store original points on first drag move
    if (!dragStartCustomVertices) {
      dragStartCustomVertices = element.shape.points.map(v => ({ ...v }));
    }

    // Move all points by the drag delta
    const newPoints = dragStartCustomVertices.map(v => ({
      x: v.x + dx,
      y: v.y + dy
    }));

    project.updateElementShape($selectedLinesLayer.id, draggedElementId, {
      points: newPoints
    } as any);
  }

  function handleShapeDragEnd(_e: MouseEvent) {
    if (isDraggingShape) recordHistory();
    isDraggingShape = false;
    dragStartPos = null;
    dragStartShapePos = null;
    draggedElementId = null;
    dragStartCustomVertices = null;
  }

  // ============================================================================
  // COORDINATE HELPERS — convert mouse events to normalized canvas 0-1 coords
  // ============================================================================

  /** Convert a mouse event to normalized 0-1 canvas coordinates, accounting for
   *  letterbox offset, pan, and zoom. Matches the hit-test coordinate system. */
  function mouseToCanvasCoords(e: MouseEvent): { x: number, y: number } {
    const rect = viewportEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // Undo pan and zoom
    const contentX = (mouseX - viewportPanX) / viewportZoom;
    const contentY = (mouseY - viewportPanY) / viewportZoom;
    // Normalize relative to the canvas area (subtract letterbox offset)
    return {
      x: (contentX - canvasOffsetX) / canvasWidth,
      y: 1 - ((contentY - canvasOffsetY) / canvasHeight)
    };
  }

  /** Convert normalized 0-1 canvas coords to SVG pixel coords within the overlay */
  function canvasToSvgX(nx: number): number { return canvasOffsetX + nx * canvasWidth; }
  function canvasToSvgY(ny: number): number { return canvasOffsetY + (1 - ny) * canvasHeight; }

  // Distance from point to a line segment, plus the t-parameter of the
  // closest point along the segment. Used by the mask add-point mode to
  // pick the edge under the cursor + interpolate the insertion point.
  function distToMaskSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { dist: number; t: number } {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return { dist: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
  }

  // Find the closest edge across all closed mask shapes to the given SVG
  // pixel position. Returns { shapeIdx, edgeIdx, t, insertNorm } or null
  // if no edge is within MASK_EDGE_HIT_THRESHOLD. insertNorm is the
  // normalized 0..1 UV coordinate where a new anchor would land if
  // inserted on that edge.
  function findClosestMaskEdge(px: number, py: number): {
    shapeIdx: number; edgeIdx: number; t: number; insertNorm: Point2D
  } | null {
    if (!$selectedLayer?.mask?.shapes) return null;
    let best: { shapeIdx: number; edgeIdx: number; t: number; dist: number; aN: Point2D; bN: Point2D } | null = null;
    for (let si = 0; si < $selectedLayer.mask.shapes.length; si++) {
      const shape = $selectedLayer.mask.shapes[si];
      if (!shape.closed || shape.points.length < 3) continue;
      for (let i = 0; i < shape.points.length; i++) {
        const a = shape.points[i];
        const b = shape.points[(i + 1) % shape.points.length];
        const aPx = { x: canvasToSvgX(a.x), y: canvasToSvgY(a.y) };
        const bPx = { x: canvasToSvgX(b.x), y: canvasToSvgY(b.y) };
        const r = distToMaskSegment({ x: px, y: py }, aPx, bPx);
        if (!best || r.dist < best.dist) {
          best = { shapeIdx: si, edgeIdx: i, t: r.t, dist: r.dist, aN: a, bN: b };
        }
      }
    }
    if (!best || best.dist > MASK_EDGE_HIT_THRESHOLD) return null;
    return {
      shapeIdx: best.shapeIdx,
      edgeIdx: best.edgeIdx,
      t: best.t,
      insertNorm: {
        x: best.aN.x + best.t * (best.bN.x - best.aN.x),
        y: best.aN.y + best.t * (best.bN.y - best.aN.y),
      },
    };
  }

  // ============================================================================
  // GENERATIVE DRAWING HANDLERS (for freehand and point-click lines)
  // ============================================================================

  function handleLinesDrawingStart(e: MouseEvent) {
    if (!$selectedLinesLayer || linesDrawingMode === 'none') return;

    let { x, y } = mouseToCanvasCoords(e);

    // Shift+click: constrain to 45-degree angles from last point
    if (e.shiftKey && linesDrawingPoints.length > 0) {
      const lastPt = linesDrawingPoints[linesDrawingPoints.length - 1];
      const dx = x - lastPt.x;
      const dy = y - lastPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      // Snap to nearest 45° (π/4) increment
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      x = lastPt.x + dist * Math.cos(snappedAngle);
      y = lastPt.y + dist * Math.sin(snappedAngle);
    }

    if (linesDrawingMode === 'freehand') {
      isLinesDrawing = true;
      linesDrawingPoints = [{ x, y }];
    } else if (linesDrawingMode === 'pointClick') {
      if (!isLinesDrawing) {
        isLinesDrawing = true;
        linesDrawingPoints = [{ x, y }];
      } else {
        linesDrawingPoints = [...linesDrawingPoints, { x, y }];
      }
    }
  }

  function handleLinesDrawingMove(e: MouseEvent) {
    if (!isLinesDrawing || linesDrawingMode !== 'freehand') return;

    let { x, y } = mouseToCanvasCoords(e);

    // Shift: constrain freehand to straight line from the start point
    if (e.shiftKey && linesDrawingPoints.length > 0) {
      const startPt = linesDrawingPoints[0];
      const dx = x - startPt.x;
      const dy = y - startPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      x = startPt.x + dist * Math.cos(snappedAngle);
      y = startPt.y + dist * Math.sin(snappedAngle);
    }

    // Only add if moved enough distance
    const lastPt = linesDrawingPoints[linesDrawingPoints.length - 1];
    const dist = Math.sqrt((x - lastPt.x) ** 2 + (y - lastPt.y) ** 2);
    if (dist > 0.005) {
      linesDrawingPoints = [...linesDrawingPoints, { x, y }];
    }
  }

  function handleLinesDrawingEnd(_e: MouseEvent) {
    if (linesDrawingMode === 'freehand' && isLinesDrawing) {
      finishLinesDrawing();
    }
    // pointClick waits for double-click or right-click
  }

  function handleLinesDrawingDoubleClick(_e: MouseEvent) {
    if (linesDrawingMode === 'pointClick' && isLinesDrawing) {
      finishLinesDrawing();
    }
  }

  function handleLinesDrawingRightClick(e: MouseEvent) {
    if (linesDrawingMode === 'pointClick' && isLinesDrawing) {
      e.preventDefault();
      finishLinesDrawing();
    }
  }

  function finishLinesDrawing() {
    if (!$selectedLinesLayer || linesDrawingPoints.length < 2) {
      isLinesDrawing = false;
      linesDrawingPoints = [];
      return;
    }

    // Create the line shape and add it to the layer
    if (linesDrawingMode === 'freehand') {
      const shape = createDefaultFreehandLine(linesDrawingPoints);
      project.addLineElement($selectedLinesLayer.id, shape);
    } else if (linesDrawingMode === 'pointClick') {
      const shape = createDefaultPointClickLine(linesDrawingPoints);
      project.addLineElement($selectedLinesLayer.id, shape);
    }

    isLinesDrawing = false;
    linesDrawingPoints = [];
    recordHistory();
    // Mode stays active — user can immediately draw the next line
  }

  // ============================================================================
  // MASK POINT INTERACTION HANDLERS
  //
  // The mask is a UNION of one-or-more bezier sub-polygons. The pen tool
  // mirrors CustomShapeHandles.svelte's Illustrator-style UX:
  //   - mousedown on empty canvas -> start a `maskPenDraft` (deferred anchor)
  //   - drag past MASK_DRAG_BEND_THRESHOLD -> flip draft to "curve" mode and
  //     show preview handles
  //   - mouseup -> commit anchor (sharp or smooth) to the current open shape
  //   - right-click or double-click empty canvas -> close the open shape
  //   - right-click an anchor -> delete it
  //   - drag an anchor or one of its handles -> live-update via the store
  // ============================================================================

  /** True if the layer's mask currently has an open sub-polygon. */
  function hasOpenMaskShape(layer: Layer | null | undefined): boolean {
    return !!layer?.mask?.shapes?.some((s) => !s.closed && s.points.length > 0);
  }

  /** Mousedown on the mask overlay (empty canvas — anchor / handle clicks are
   *  caught by their own mousedown handlers and stopPropagation). */
  function handleMaskMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (!$selectedLayer?.mask?.enabled) return;
    // Ignore clicks that originate on anchor / handle dots
    const target = e.target as Element | null;
    if (target && target.closest('.mask-anchor, .mask-handle, .mask-pen-toolbar')) return;

    // Add mode: detect edge under cursor and insert a knot there instead
    // of treating the click as a new draw-mode anchor. Add only operates
    // on closed shapes; empty-canvas clicks while in add mode and not over
    // any edge are intentionally a no-op so the user doesn't accidentally
    // start a new shape.
    if (maskPenMode === 'add') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;
      const hit = findClosestMaskEdge(svgX, svgY);
      if (hit) {
        project.insertMaskPoint($selectedLayer.id, hit.shapeIdx, hit.edgeIdx, hit.insertNorm);
        recordHistory();
      }
      return;
    }
    // Remove mode: empty-canvas clicks are no-op; user must click an
    // anchor (handled by handleMaskAnchorMouseDown which checks the mode).
    if (maskPenMode === 'remove') return;

    const norm = mouseToCanvasCoords(e);
    const clampedAnchor: Point2D = {
      x: Math.max(0, Math.min(1, norm.x)),
      y: Math.max(0, Math.min(1, norm.y)),
    };
    // Convert anchor back to SVG-pixel space for the live preview overlay so
    // drag-distance math is in pixels (consistent with the threshold).
    const anchorPx = { x: canvasToSvgX(clampedAnchor.x), y: canvasToSvgY(clampedAnchor.y) };
    maskPenDraft = {
      anchor: clampedAnchor,
      anchorPx,
      dragPx: { ...anchorPx },
      isCurve: false,
    };
    window.addEventListener('mousemove', handleMaskPenMove);
    window.addEventListener('mouseup', handleMaskPenUp);
  }

  function handleMaskPenMove(e: MouseEvent) {
    if (!maskPenDraft) return;
    // Track the cursor in normalized-canvas space, then convert to SVG-pixel
    // space for the preview and drag-distance calculation.
    const norm = mouseToCanvasCoords(e);
    const clamped: Point2D = {
      x: Math.max(0, Math.min(1, norm.x)),
      y: Math.max(0, Math.min(1, norm.y)),
    };
    const dragPx = { x: canvasToSvgX(clamped.x), y: canvasToSvgY(clamped.y) };
    maskPenDraft.dragPx = dragPx;
    const dist = Math.hypot(dragPx.x - maskPenDraft.anchorPx.x, dragPx.y - maskPenDraft.anchorPx.y);
    maskPenDraft.isCurve = dist > MASK_DRAG_BEND_THRESHOLD;
    // Reassign to trigger reactivity for the preview overlay
    maskPenDraft = maskPenDraft;
  }

  function handleMaskPenUp(e: MouseEvent) {
    window.removeEventListener('mousemove', handleMaskPenMove);
    window.removeEventListener('mouseup', handleMaskPenUp);
    if (!maskPenDraft || !$selectedLayer) {
      maskPenDraft = null;
      return;
    }
    const draft = maskPenDraft;
    maskPenDraft = null;
    const layerId = $selectedLayer.id;

    // Commit the anchor — the store routes it to the last unclosed shape, or
    // starts a new shape if none is open.
    const anchorPoint: BezierPoint = { x: draft.anchor.x, y: draft.anchor.y };
    project.addMaskPoint(layerId, anchorPoint);

    if (draft.isCurve) {
      // Compute cpOut in normalized space from the final mouse position.
      const finalNorm = mouseToCanvasCoords(e);
      const cpOutNorm: Point2D = {
        x: Math.max(-2, Math.min(3, finalNorm.x)),
        y: Math.max(-2, Math.min(3, finalNorm.y)),
      };
      const cpInNorm: Point2D = {
        x: 2 * draft.anchor.x - cpOutNorm.x,
        y: 2 * draft.anchor.y - cpOutNorm.y,
      };
      // Find the just-added anchor — it's the last point of the last unclosed shape.
      const post = $selectedLayer;
      const shapes = post?.mask?.shapes ?? [];
      // Prefer the LAST UNCLOSED shape (consistent with how addMaskPoint routes).
      let targetShapeIdx = -1;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (!shapes[i].closed) { targetShapeIdx = i; break; }
      }
      // Fallback: if every shape is somehow closed, use the absolute last.
      if (targetShapeIdx < 0) targetShapeIdx = shapes.length - 1;
      if (targetShapeIdx >= 0) {
        const targetShape = shapes[targetShapeIdx];
        const newPointIdx = targetShape.points.length - 1;
        if (newPointIdx >= 0) {
          project.setMaskPointHandle(layerId, targetShapeIdx, newPointIdx, 'cpOut', cpOutNorm);
          project.setMaskPointHandle(layerId, targetShapeIdx, newPointIdx, 'cpIn', cpInNorm);
        }
      }
    }
    recordHistory();
  }

  /** Right-click on empty canvas: close the current open shape. */
  function handleMaskOverlayContextMenu(e: MouseEvent) {
    if (!$selectedLayer?.mask?.enabled) return;
    // Anchor right-click is handled separately and stopPropagation()s.
    const target = e.target as Element | null;
    if (target && target.closest('.mask-anchor, .mask-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    project.closeMaskShape($selectedLayer.id);
    recordHistory();
  }

  /** Anchor mousedown — start dragging this anchor (move x/y + carry handles).
   *  Special case: clicking the FIRST anchor of the currently-open shape
   *  closes the shape (provided it has at least 3 anchors). This matches
   *  the conventional pen-tool "click first point to close" UX. */
  function handleMaskAnchorMouseDown(shapeIndex: number, pointIndex: number, e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const mask = $selectedLayer?.mask;
    // Remove mode: left-click on anchor deletes it. Match the
    // CustomShapeHandles behaviour where the toolbar shifts what a
    // click does without forcing the user to right-click.
    if (maskPenMode === 'remove' && mask) {
      const shape = mask.shapes[shapeIndex];
      // Don't drop a closed shape below 3 anchors — that's the minimum
      // for a valid polygon. The store would otherwise nuke the whole
      // shape (consistent with right-click delete) which is surprising
      // when the user just wanted to trim one point.
      if (shape?.closed && shape.points.length <= 3) return;
      project.removeMaskPoint($selectedLayer!.id, shapeIndex, pointIndex);
      recordHistory();
      return;
    }
    if (mask && pointIndex === 0) {
      const shape = mask.shapes[shapeIndex];
      if (shape && !shape.closed && shape.points.length >= 3) {
        project.closeMaskShape($selectedLayer!.id);
        recordHistory();
        return;
      }
    }
    draggingMaskAnchor = { shapeIndex, pointIndex };
    window.addEventListener('mousemove', handleMaskAnchorDrag);
    window.addEventListener('mouseup', handleMaskAnchorDragEnd);
  }

  // Track cursor over the mask overlay for add-mode hover feedback.
  function handleMaskOverlayMouseMove(e: MouseEvent) {
    if (maskPenMode !== 'add' || !$selectedLayer?.mask?.enabled) {
      if (maskHoverEdgeIdx !== -1) {
        maskHoverEdgeIdx = -1;
        maskHoverShapeIdx = -1;
      }
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    maskHoverPx = { x: svgX, y: svgY };
    const hit = findClosestMaskEdge(svgX, svgY);
    if (hit) {
      maskHoverShapeIdx = hit.shapeIdx;
      maskHoverEdgeIdx = hit.edgeIdx;
    } else {
      maskHoverShapeIdx = -1;
      maskHoverEdgeIdx = -1;
    }
  }

  function handleMaskAnchorDrag(e: MouseEvent) {
    if (!draggingMaskAnchor || !$selectedLayer?.mask) return;
    const coords = mouseToCanvasCoords(e);
    const newX = Math.max(0, Math.min(1, coords.x));
    const newY = Math.max(0, Math.min(1, coords.y));
    const shape = $selectedLayer.mask.shapes[draggingMaskAnchor.shapeIndex];
    if (!shape) return;
    const pt = shape.points[draggingMaskAnchor.pointIndex];
    if (!pt) return;
    const dx = newX - pt.x;
    const dy = newY - pt.y;
    const partial: Partial<BezierPoint> = { x: newX, y: newY };
    if (pt.cpIn) partial.cpIn = { x: pt.cpIn.x + dx, y: pt.cpIn.y + dy };
    if (pt.cpOut) partial.cpOut = { x: pt.cpOut.x + dx, y: pt.cpOut.y + dy };
    project.updateMaskPoint($selectedLayer.id, draggingMaskAnchor.shapeIndex, draggingMaskAnchor.pointIndex, partial);
  }

  function handleMaskAnchorDragEnd() {
    if (draggingMaskAnchor !== null) recordHistory();
    draggingMaskAnchor = null;
    window.removeEventListener('mousemove', handleMaskAnchorDrag);
    window.removeEventListener('mouseup', handleMaskAnchorDragEnd);
  }

  /** Right-click an anchor: delete it. */
  function handleMaskAnchorRightClick(shapeIndex: number, pointIndex: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!$selectedLayer?.mask) return;
    project.removeMaskPoint($selectedLayer.id, shapeIndex, pointIndex);
    recordHistory();
  }

  /** Control-handle mousedown — drag a cpIn/cpOut handle, mirror the other side. */
  function handleMaskHandleMouseDown(shapeIndex: number, pointIndex: number, which: 'cpIn' | 'cpOut', e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    draggingMaskHandle = { shapeIndex, pointIndex, which };
    window.addEventListener('mousemove', handleMaskHandleDrag);
    window.addEventListener('mouseup', handleMaskHandleDragEnd);
  }

  function handleMaskHandleDrag(e: MouseEvent) {
    if (!draggingMaskHandle || !$selectedLayer?.mask) return;
    const coords = mouseToCanvasCoords(e);
    const newPos: Point2D = {
      x: Math.max(0, Math.min(1, coords.x)),
      y: Math.max(0, Math.min(1, coords.y)),
    };
    project.setMaskPointHandle(
      $selectedLayer.id,
      draggingMaskHandle.shapeIndex,
      draggingMaskHandle.pointIndex,
      draggingMaskHandle.which,
      newPos
    );
    // Mirror the opposite handle unless Alt is held (matches CustomShapeHandles).
    if (!e.altKey) {
      const shape = $selectedLayer.mask.shapes[draggingMaskHandle.shapeIndex];
      const pt = shape?.points[draggingMaskHandle.pointIndex];
      if (pt) {
        const mirrorWhich: 'cpIn' | 'cpOut' = draggingMaskHandle.which === 'cpIn' ? 'cpOut' : 'cpIn';
        const mirror: Point2D = { x: 2 * pt.x - newPos.x, y: 2 * pt.y - newPos.y };
        project.setMaskPointHandle(
          $selectedLayer.id,
          draggingMaskHandle.shapeIndex,
          draggingMaskHandle.pointIndex,
          mirrorWhich,
          mirror
        );
      }
    }
  }

  function handleMaskHandleDragEnd() {
    if (draggingMaskHandle !== null) recordHistory();
    draggingMaskHandle = null;
    window.removeEventListener('mousemove', handleMaskHandleDrag);
    window.removeEventListener('mouseup', handleMaskHandleDragEnd);
  }

  /** Return the trailing open sub-polygon (with at least one anchor), or null
   *  if every shape is closed. Mirrors how the store routes new anchors. */
  function findOpenMaskShape(shapes: Array<{ points: BezierPoint[]; closed: boolean }>): { points: BezierPoint[]; closed: boolean } | null {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (!s.closed && s.points.length > 0) return s;
    }
    return null;
  }

  /** Build an SVG path "d" string for one mask sub-polygon. Uses C-curves
   *  between any two anchors when either side carries a handle, else L lines.
   *  Closed shapes terminate with Z. */
  function buildMaskShapePath(shape: { points: BezierPoint[]; closed: boolean }): string {
    const pts = shape.points;
    if (pts.length < 2) return '';
    let d = `M ${canvasToSvgX(pts[0].x)},${canvasToSvgY(pts[0].y)}`;
    const segCount = shape.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const hasCurve = a.cpOut || b.cpIn;
      if (hasCurve) {
        const cp1 = a.cpOut ?? a;
        const cp2 = b.cpIn ?? b;
        d += ` C ${canvasToSvgX(cp1.x)},${canvasToSvgY(cp1.y)} ${canvasToSvgX(cp2.x)},${canvasToSvgY(cp2.y)} ${canvasToSvgX(b.x)},${canvasToSvgY(b.y)}`;
      } else {
        d += ` L ${canvasToSvgX(b.x)},${canvasToSvgY(b.y)}`;
      }
    }
    if (shape.closed) d += ' Z';
    return d;
  }

  // Exit shape-warp mode automatically if selected layer can't use it
  $: if (shapeWarpModeEnabled && (!$selectedLayer || !isLayerShapeWarpable($selectedLayer))) {
    shapeWarpModeEnabled = false;
  }
  $: if (shapeWarpModeEnabled) {
    ensureActiveLayerShapeControlPoints();
  }
  $: layerShapeControlPoints = $selectedLayer?.layerShape?.controlPoints ?? [];

  // ============================================================================
  // SHAPE VERTEX DRAGGING (for editing shape control points)
  // ============================================================================

  let isDraggingVertex = false;
  let draggedVertexInfo: { elementId: string; vertexIndex: number; vertexType: string } | null = null;

  // Warp mode toggle - only show vertex handles and allow vertex editing when enabled
  let warpModeEnabled = false;

  /**
   * Get the display vertices for a line element's shape.
   * Lines always have points arrays — no parametric shapes.
   */
  function getShapeVertices(element: typeof $selectedLineElement): { x: number; y: number; index: number; type: string }[] {
    if (!element) return [];
    return element.shape.points.map((pt, i) => ({
      x: pt.x,
      y: pt.y,
      index: i,
      type: 'point'
    }));
  }

  function handleVertexMouseDown(e: MouseEvent, elementId: string, vertexIndex: number, _vertexType: string) {
    e.stopPropagation();
    isDraggingVertex = true;
    draggedVertexInfo = { elementId, vertexIndex, vertexType: 'point' };
  }

  function handleVertexDrag(e: MouseEvent) {
    if (!isDraggingVertex || !draggedVertexInfo || !$selectedLinesLayer) return;

    const { x, y } = mouseToCanvasCoords(e);

    const element = $selectedLinesLayer.linesContent?.elements.find(
      el => el.id === draggedVertexInfo!.elementId
    );
    if (!element) return;

    // Update the point directly in the shape's points array
    const newPoints = [...element.shape.points];
    if (draggedVertexInfo.vertexIndex < newPoints.length) {
      newPoints[draggedVertexInfo.vertexIndex] = { x, y };
      project.updateElementShape($selectedLinesLayer.id, element.id, { points: newPoints } as any);
    }
  }

  function handleVertexDragEnd(_e: MouseEvent) {
    if (isDraggingVertex) recordHistory();
    isDraggingVertex = false;
    draggedVertexInfo = null;
  }

  /**
   * Add a new vertex to the selected line shape.
   * Inserts a midpoint between afterIndex and the next point.
   */
  function addVertexToShape(afterIndex: number) {
    if (!$selectedLinesLayer || !$selectedLineElement) return;

    const points = [...$selectedLineElement.shape.points];
    if (points.length < 2) return;

    // Calculate midpoint between afterIndex and next point
    const nextIndex = (afterIndex + 1) % points.length;
    const p1 = points[afterIndex];
    const p2 = points[nextIndex];
    const newPt: Point2D = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    };

    points.splice(afterIndex + 1, 0, newPt);
    project.updateElementShape($selectedLinesLayer.id, $selectedLineElement.id, { points } as any);
    recordHistory();
  }

  /**
   * Remove a vertex from the selected line shape (keep at least 2 points)
   */
  function removeVertexFromShape(index: number) {
    if (!$selectedLinesLayer || !$selectedLineElement) return;

    const points = [...$selectedLineElement.shape.points];
    if (points.length <= 2) return; // Lines need at least 2 points

    points.splice(index, 1);
    project.updateElementShape($selectedLinesLayer.id, $selectedLineElement.id, { points } as any);
    recordHistory();
  }

  // Reactive: get vertices for selected element
  $: selectedVertices = $selectedLineElement ? getShapeVertices($selectedLineElement) : [];
</script>

{#if isMobile}
  <MobileApp />
{:else}
  <div class="app">
    <!-- Integrated/software GPU warning banner. Surfaces ONCE per
         install when the detected renderer is integrated/software.
         Routes the user to Settings → Performance. -->
    {#if showIntegratedGpuBanner && gpuInfo}
      <div class="gpu-warning-banner" role="alert">
        <div class="gpu-warning-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <circle cx="12" cy="17" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div class="gpu-warning-body">
          <strong>Running on integrated graphics</strong>
          <span class="gpu-warning-detail">Detected: <code>{gpuInfo.renderer}</code>. For smoother playback you can either switch to your dedicated GPU in system settings, or dial down the editor's performance settings to match.</span>
          <a class="gpu-warning-link"
             href="https://ghostarcade.live/docs/performance"
             target="_blank"
             rel="noopener noreferrer">Performance guide →</a>
        </div>
        <div class="gpu-warning-actions">
          <button class="gpu-warning-dismiss persist" onclick={() => { showSettings = true; window.location.hash = '#performance'; }} title="Open Settings → Performance">Tune Performance</button>
          <button class="gpu-warning-dismiss" onclick={() => dismissIntegratedGpuBanner(false)} title="Dismiss for this session">Dismiss</button>
          <button class="gpu-warning-dismiss" onclick={() => dismissIntegratedGpuBanner(true)} title="Never show this again">Don't show again</button>
        </div>
      </div>
    {/if}

    <!-- Header / Toolbar -->
    <header class="toolbar">
      <div class="toolbar-left">
        <img src="{import.meta.env.BASE_URL}logo.png" alt="Ghost Arcade" class="header-logo" />
        {#if gpuInfo}
          <span
            class="gpu-indicator"
            class:integrated={gpuInfo.isIntegrated}
            title="{gpuInfo.renderer} ({gpuInfo.vendor}){gpuInfo.isIntegrated ? ' — WARNING: Integrated GPU. Set this app to High Performance in Windows Graphics Settings.' : ''}"
          >
            <span class="gpu-dot"></span>
            GPU
          </span>
        {/if}
        <!-- Windows-style File Menu -->
        <div class="file-menu-container">
          <button
            class="file-menu-btn"
            class:active={fileMenuOpen}
            onclick={() => fileMenuOpen = !fileMenuOpen}
          >
            File
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </button>
          {#if fileMenuOpen}
            <div class="file-menu-dropdown">
              <button class="menu-item" onclick={newComposition}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="12" y1="18" x2="12" y2="12"></line>
                    <line x1="9" y1="15" x2="15" y2="15"></line>
                  </svg>
                </span>
                <span class="menu-label">New</span>
                <span class="menu-shortcut">Ctrl+N</span>
              </button>
              <button class="menu-item" onclick={loadComposition}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </span>
                <span class="menu-label">Open...</span>
                <span class="menu-shortcut">Ctrl+O</span>
              </button>
              {#if $recentFiles.length > 0}
                <div class="menu-separator"></div>
                <div class="menu-section-label">Recent Files</div>
                {#each $recentFiles as recent (recent.timestamp)}
                  <button
                    class="menu-item menu-item-recent"
                    onclick={() => openRecentFile(recent)}
                    title={recent.path || recent.name}
                  >
                    <span class="menu-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                      </svg>
                    </span>
                    <span class="menu-label menu-label-truncate">{recent.name}</span>
                  </button>
                {/each}
                <button class="menu-item menu-item-small" onclick={() => { recentFiles.clear(); fileMenuOpen = false; }}>
                  <span class="menu-icon"></span>
                  <span class="menu-label">Clear Recent Files</span>
                </button>
              {/if}
              <div class="menu-separator"></div>
              <button class="menu-item" onclick={saveComposition}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </span>
                <span class="menu-label">Save</span>
                <span class="menu-shortcut">Ctrl+S</span>
              </button>
              <button class="menu-item" onclick={saveCompositionAs}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </span>
                <span class="menu-label">Save As...</span>
                <span class="menu-shortcut">Ctrl+Shift+S</span>
              </button>
              <div class="menu-separator"></div>
              <!-- Offline render — opens the modal where the user
                   picks duration / fps / resolution and the system
                   deterministically renders + encodes to MP4. -->
              <button class="menu-item" onclick={() => { fileMenuOpen = false; showOfflineRender = true; }}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                </span>
                <span class="menu-label">Render to Video...</span>
              </button>
              <div class="menu-separator"></div>
              <button class="menu-item" onclick={importPresetsFromFile}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </span>
                <span class="menu-label">Import Presets...</span>
              </button>
              <button class="menu-item" onclick={exportPresetsToFile}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                </span>
                <span class="menu-label">Export Presets...</span>
              </button>
              <div class="menu-separator"></div>
              <button class="menu-item" onclick={() => loadDemoProject()} disabled={demoLoading}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </span>
                <span class="menu-label">{demoLoading ? `Downloading ${demoProgress}%...` : 'Load Demo Project'}</span>
              </button>
              <div class="menu-separator"></div>
              <button class="menu-item" onclick={handleUndo} disabled={!$canUndo}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v6h6"></path>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
                  </svg>
                </span>
                <span class="menu-label">Undo</span>
                <span class="menu-shortcut">Ctrl+Z</span>
              </button>
              <button class="menu-item" onclick={handleRedo} disabled={!$canRedo}>
                <span class="menu-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 7v6h-6"></path>
                    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
                  </svg>
                </span>
                <span class="menu-label">Redo</span>
                <span class="menu-shortcut">Ctrl+Y</span>
              </button>
            </div>
          {/if}
        </div>
        <!-- VJ Preset Save Area -->
        <div class="vj-preset-save">
          <input
            type="text"
            placeholder="Preset name..."
            bind:value={vjPresetName}
            onkeydown={(e) => e.key === 'Enter' && saveVJPreset()}
            class="vj-preset-input"
          />
          <button class="vj-preset-btn" onclick={saveVJPreset} title="Save as Preset">
            + Preset
          </button>
        </div>
      </div>
      <!-- Hidden file input for loading compositions -->
      <input
        type="file"
        accept=".gha,.shrnk,.json"
        style="display: none;"
        bind:this={fileInput}
        onchange={handleFileLoad}
      />

      <div class="toolbar-center">
        <button
          class="output-btn"
          class:active={outputMode === 'embedded'}
          onclick={() => { closeOutputWindow(); outputMode = 'embedded'; }}
        >
          Preview
        </button>
        <button
          class="output-btn"
          class:active={outputMode === 'window'}
          onclick={outputIsOpen ? closeOutputWindow : openOutputWindow}
        >
          {outputIsOpen ? 'Close Output' : 'Output Window'}
        </button>
        <button
          class="output-btn"
          class:active={outputMode === 'fullscreen'}
          onclick={toggleFullscreen}
        >
          Fullscreen
        </button>
      </div>

      <div class="toolbar-right">
        <!-- Blackout Button -->
        <button
          class="blackout-btn"
          class:active={$settings.output.blackout}
          onclick={() => settings.update(s => ({ ...s, output: { ...s.output, blackout: !s.output.blackout } }))}
          title={$settings.output.blackout ? 'End Blackout (B)' : 'Blackout (B)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>

        <!-- Test Pattern Button — toggles 'none' ↔ 'grid'. Pulses orange
             when active so the user can't forget to turn it off. v0.3.5
             removed the global Settings UI for this because users left
             it on by accident; this top-bar version is impossible to
             miss. Right-click menu (future) can pick which pattern. -->
        <button
          class="testpattern-btn"
          class:active={$settings.output.testPattern && $settings.output.testPattern !== 'none'}
          onclick={() => settings.update(s => {
            const active = s.output.testPattern && s.output.testPattern !== 'none';
            return { ...s, output: { ...s.output, testPattern: active ? 'none' : 'grid' } };
          })}
          title={
            $settings.output.testPattern && $settings.output.testPattern !== 'none'
              ? 'Test Pattern ON — click to hide and see content'
              : 'Show alignment grid (test pattern)'
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="1" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
          </svg>
        </button>

        <!-- Freeze Button -->
        <button
          class="freeze-btn"
          class:active={$outputFrozen}
          onclick={toggleFreeze}
          title={$outputFrozen ? 'Resume Output' : 'Freeze Output'}
        >
          {#if $outputFrozen}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="3" width="6" height="18"/>
              <rect x="14" y="3" width="6" height="18"/>
            </svg>
          {/if}
        </button>

        <!-- Audio input picker — shared component used in mapping, VJ, and
             Performer modes so users see the same UI everywhere. Includes
             mic toggle, device-picker chevron + popover, and system-audio
             toggle. State is wired through the global audioStore so toggling
             in one mode is reflected in every other mode. -->
        <AudioInputPicker />

        <!-- TAP tempo + BPM readout. Auto-hides when audio is off so the
             top bar stays clean for users who never use audio reactivity. -->
        <BpmTapWidget />

        <!-- Screenshot Button -->
        <button class="screenshot-btn" onclick={takeScreenshot} title="Take Screenshot">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>

        <!-- Recording Button -->
        {#if isRecording}
          <div class="recording-indicator">
            <span class="rec-dot"></span>
            {#if recorderHandle?.hasAudio}<span class="rec-audio-badge" title="Recording audio">🔊</span>{/if}
            <span class="rec-time">{formatRecordingDuration(recordingDuration)}</span>
          </div>
          <button class="stop-rec-btn" onclick={stopRecording}>
            Stop Rec
          </button>
        {:else}
          <button class="rec-btn" onclick={startRecording} title="Record Output (with audio if active)">
            ● REC
          </button>
        {/if}

        <!-- VJ Mixer Button -->
        <button class="vj-btn" onclick={openVJMode} title="Open VJ Mixer">
          VJ
        </button>

        <!-- Stage Designer Button — opens the SVG-import / polygon-slice
             projection-mapping workspace. Mutually exclusive with VJ
             mode via the activeWorkspace flag in the workspace store. -->
        <button class="stage-btn" onclick={() => workspace.openStage()} title="Open Stage Designer">
          STAGE
        </button>

        <!-- Settings Button -->
        <button class="settings-btn" onclick={() => showSettings = true} title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>

        <div class="mobile-btn-wrapper">
          <button
            class="connection-btn"
            class:connected={mobileConnected}
            class:error={!!connectionError}
            onclick={async () => {
              showMobileInfo = !showMobileInfo;
              if (showMobileInfo) {
                await fetchLocalIPs();
                await generateQRCode();
                if (!wsServerReady && !ws) {
                  connectToServer();
                }
              }
            }}
          >
            <span class="dot"></span>
            {#if mobileConnected}
              Mobile: {clientCount - 1} connected
            {:else}
              Connect Mobile
            {/if}
          </button>

          {#if showMobileInfo}
            <div class="mobile-info-popup">
            <h4>Mobile Control</h4>

            <!-- Connection Status -->
            {#if connectionError}
              <div class="connection-error">
                <p>{connectionError}</p>
                <button class="retry-btn" onclick={() => { connectionError = ''; connectToServer(); }}>
                  Retry Connection
                </button>
              </div>
            {:else if !wsServerReady}
              <div class="connecting-status">
                <p>Connecting to WebSocket server...</p>
                <p class="hint">WebSocket server starting... please wait</p>
              </div>
            {:else}
              <!-- QR Code -->
              {#if qrCodeDataUrl}
                <div class="qr-container">
                  <img src={qrCodeDataUrl} alt="QR Code for mobile connection" class="qr-code" />
                  <p class="qr-hint">Scan with your phone/iPad camera</p>
                </div>
              {/if}

              <!-- Network Selection -->
              {#if localIPs.length > 1}
                <div class="ip-selector">
                  <label>Select Network:</label>
                  <select bind:value={selectedIP}>
                    {#each localIPs as ip}
                      <option value={ip}>{ip}</option>
                    {/each}
                  </select>
                </div>
              {/if}

              <!-- Connection Details -->
              <div class="connection-details">
                <div class="detail-row">
                  <span class="detail-label">URL:</span>
                  <code class="detail-value">{getMobileUrl()}</code>
                </div>
                <div class="detail-row">
                  <span class="detail-label">WebSocket:</span>
                  <code class="detail-value">{getWebSocketUrl()}</code>
                </div>
              </div>

              <div class="instructions">
                <p><strong>Quick Setup:</strong></p>
                <ol>
                  <li>Connect iPad to same WiFi/hotspot</li>
                  <li>Scan QR code or enter URL manually</li>
                  <li>Enter WebSocket URL when prompted</li>
                  <li>Tap Connect - drag corners to warp!</li>
                </ol>
              </div>
            {/if}

            <button onclick={() => (showMobileInfo = false)}>Close</button>
          </div>
          {/if}
        </div>

      </div>
    </header>

    <!-- Main Content -->
    <main class="main-content" class:kf-tray-open={$keyframeTimeline.isOpen}>
      <!-- Layer Panel on left -->
      <LayerPanel />

      <!-- Viewport with canvas and warp handles -->
      <div
        class="viewport"
        bind:this={viewportEl}
        onmousedown={handleViewportMouseDown}
        onmousemove={handleViewportMouseMove}
        onmouseup={handleViewportMouseUp}
        onmouseleave={(e) => { handleViewportMouseUp(e); handleViewportMouseLeave(); }}
        class:panning={isPanning}
        class:space-ready={isSpacePressed}
        role="presentation"
      >
        <div
          class="viewport-content"
          style="transform: translate({viewportPanX}px, {viewportPanY}px) scale({viewportZoom}); transform-origin: 0 0;"
        >
        <!--
          Phase 3.0 (Bridge-A) of the editor renderer migration.

          When experimental.editorWebGPU is OFF (default): mount
          Canvas alone — the existing WebGL renderer path.

          When ON: mount BOTH:
            - Canvas in bridgeMode (its WebGL <canvas> is hidden via
              opacity:0 but still painted by Chromium each frame)
            - WebGPUCanvas overlaid on top, sourcing the WebGL canvas
              and presenting it via VideoFrame + importExternalTexture
              on a WebGPU canvas

          Net effect: the editor visually renders identically to the
          WebGL path, but the FINAL present surface (which captureStream
          pulls from for the output presenter) is now WebGPU. This
          unblocks Phase 3.x — per-layer WebGPU renderers can be
          composited on top of the bridge surface incrementally,
          eventually replacing it.

          canvasComponent is bound to the Canvas instance in BOTH
          cases so all downstream code that calls getEngine() etc.
          continues to work transparently.

          See docs/WEBGPU_MIGRATION.md for the full roadmap.
        -->
        {#if $settings.experimental?.editorWebGPU}
          <Canvas bind:this={canvasComponent} bridgeMode={true} />
          <WebGPUCanvas bind:this={webgpuBridgeComponent} />
        {:else}
          <Canvas bind:this={canvasComponent} />
        {/if}
        <!-- Grid overlay — mounted at App.svelte level (sibling to
             Canvas + WebGPUCanvas) so it stays visible regardless of
             which presenter is active. The WebGPU bridge overlay sits
             at z-index 10 over .canvas-wrapper, so anything mounted
             inside Canvas's .canvas-container is hidden when WebGPU
             is on. Wrapper is positioned + sized to mirror Canvas's
             aspect-ratio-constrained .canvas-container rect, and the
             grid SVG self-sizes 100% × 100% inside it. -->
        {#if $settings.ui.gridSettings?.enabled}
          <div
            class="grid-overlay-offset"
            style="left: {canvasOffsetX}px; top: {canvasOffsetY}px; width: {canvasWidth}px; height: {canvasHeight}px;"
          >
            <GridOverlay />
          </div>
        {/if}
        {#if $selectedLayer}
          <!-- Warp handles positioned to match the aspect-ratio-constrained canvas -->
          <div class="warp-handles-offset" style="left: {canvasOffsetX}px; top: {canvasOffsetY}px;">
            <WarpHandles containerWidth={canvasWidth} containerHeight={canvasHeight} zoom={viewportZoom} hideCorners={$selectedLayer.warpMode === 'mesh'} shapeWarpActive={shapeWarpModeEnabled} />
            {#if $selectedLayer.warpMode === 'mesh'}
              <MeshWarpHandles containerWidth={canvasWidth} containerHeight={canvasHeight} zoom={viewportZoom} />
            {/if}

            {#if $selectedLayer.layerShape?.type === 'custom'}
              <CustomShapeHandles containerWidth={canvasWidth} containerHeight={canvasHeight} zoom={viewportZoom} />
            {/if}

            {#if isLayerShapeWarpable($selectedLayer)}
              {@const warpCorners = $selectedLayer.corners}
              <svg
                class="layer-shape-warp-overlay"
                bind:this={shapeWarpOverlayEl}
                style="width: {canvasWidth}px; height: {canvasHeight}px;"
                class:editing={shapeWarpModeEnabled}
              >
                {#if $selectedLayer.layerShape?.type === 'circle' && layerShapeControlPoints.length >= 5 && warpCorners}
                  {@const w0 = warpPointThroughCorners(warpCorners, layerShapeControlPoints[0].x, layerShapeControlPoints[0].y)}
                  {@const w1 = warpPointThroughCorners(warpCorners, layerShapeControlPoints[1].x, layerShapeControlPoints[1].y)}
                  {@const w2 = warpPointThroughCorners(warpCorners, layerShapeControlPoints[2].x, layerShapeControlPoints[2].y)}
                  {@const w3 = warpPointThroughCorners(warpCorners, layerShapeControlPoints[3].x, layerShapeControlPoints[3].y)}
                  {@const wc = warpPointThroughCorners(warpCorners, layerShapeControlPoints[4].x, layerShapeControlPoints[4].y)}
                  <line x1={w0.x * canvasWidth} y1={(1 - w0.y) * canvasHeight} x2={w3.x * canvasWidth} y2={(1 - w3.y) * canvasHeight} stroke="#67E8F9" stroke-width="1.5" />
                  <line x1={w1.x * canvasWidth} y1={(1 - w1.y) * canvasHeight} x2={w2.x * canvasWidth} y2={(1 - w2.y) * canvasHeight} stroke="#67E8F9" stroke-width="1.5" />
                  <line x1={wc.x * canvasWidth} y1={(1 - wc.y) * canvasHeight} x2={w0.x * canvasWidth} y2={(1 - w0.y) * canvasHeight} stroke="#67E8F9" stroke-width="1" opacity="0.55" />
                  <line x1={wc.x * canvasWidth} y1={(1 - wc.y) * canvasHeight} x2={w1.x * canvasWidth} y2={(1 - w1.y) * canvasHeight} stroke="#67E8F9" stroke-width="1" opacity="0.55" />
                  <line x1={wc.x * canvasWidth} y1={(1 - wc.y) * canvasHeight} x2={w2.x * canvasWidth} y2={(1 - w2.y) * canvasHeight} stroke="#67E8F9" stroke-width="1" opacity="0.55" />
                  <line x1={wc.x * canvasWidth} y1={(1 - wc.y) * canvasHeight} x2={w3.x * canvasWidth} y2={(1 - w3.y) * canvasHeight} stroke="#67E8F9" stroke-width="1" opacity="0.55" />
                {:else if $selectedLayer.layerShape?.type === 'triangle' && layerShapeControlPoints.length >= 3 && warpCorners}
                  <polygon
                    points={layerShapeControlPoints.slice(0, 3).map((p) => { const w = warpPointThroughCorners(warpCorners, p.x, p.y); return `${w.x * canvasWidth},${(1 - w.y) * canvasHeight}`; }).join(' ')}
                    fill="none"
                    stroke="#67E8F9"
                    stroke-width="2"
                    opacity={shapeWarpModeEnabled ? 1 : 0.75}
                  />
                {/if}

                {#if shapeWarpModeEnabled && warpCorners}
                  {#each layerShapeControlPoints as point, i}
                    {@const isCircleCenter = $selectedLayer.layerShape?.type === 'circle' && i === 4}
                    {@const warped = warpPointThroughCorners(warpCorners, point.x, point.y)}
                    <circle
                      cx={warped.x * canvasWidth}
                      cy={(1 - warped.y) * canvasHeight}
                      r={isCircleCenter ? 7 : 10}
                      fill={isCircleCenter ? '#0B1220' : '#67E8F9'}
                      stroke="#67E8F9"
                      stroke-width="2"
                      style="cursor: move;"
                      onmousedown={(e) => startShapeControlPointDrag(i, e)}
                    />
                  {/each}
                {/if}
              </svg>
            {/if}

          </div>
        {/if}

        <!-- Multi-select outlines for all selected layers (except primary which has WarpHandles) -->
        {#if $selectedLayerIds.length > 1}
          <div class="multi-select-overlay" style="left: {canvasOffsetX}px; top: {canvasOffsetY}px;">
            <svg width={canvasWidth} height={canvasHeight} class="multi-select-svg">
              {#each $selectedLayerIds as selId}
                {#if selId !== $selectedLayer?.id}
                  {@const selLayer = $project.layers.find(l => l.id === selId)}
                  {#if selLayer?.corners}
                    {@const tl = selLayer.corners.topLeft}
                    {@const tr = selLayer.corners.topRight}
                    {@const bl = selLayer.corners.bottomLeft}
                    {@const br = selLayer.corners.bottomRight}
                    <polygon
                      points="{tl.x * canvasWidth},{(1 - tl.y) * canvasHeight} {tr.x * canvasWidth},{(1 - tr.y) * canvasHeight} {br.x * canvasWidth},{(1 - br.y) * canvasHeight} {bl.x * canvasWidth},{(1 - bl.y) * canvasHeight}"
                      fill="rgba(76,175,80,0.06)"
                      stroke="#4CAF50"
                      stroke-width="1.5"
                      stroke-dasharray="6,3"
                    />
                  {/if}
                {/if}
              {/each}
            </svg>
          </div>
        {/if}

        <!-- Shape interaction overlay for lines layers -->
        {#if $selectedLinesLayer}
          <div
            class="shape-interaction-overlay"
            class:drawing-active={linesDrawingMode !== 'none'}
            onmousedown={(e) => {
              if (linesDrawingMode !== 'none') {
                handleLinesDrawingStart(e);
              } else if (!isDraggingVertex) {
                handleShapeClick(e);
              }
            }}
            onmousemove={(e) => {
              if (linesDrawingMode !== 'none') {
                handleLinesDrawingMove(e);
              } else if (isDraggingVertex) {
                handleVertexDrag(e);
              } else {
                handleShapeDrag(e);
              }
            }}
            onmouseup={(e) => {
              if (linesDrawingMode !== 'none') {
                handleLinesDrawingEnd(e);
              } else if (isDraggingVertex) {
                handleVertexDragEnd(e);
              } else {
                handleShapeDragEnd(e);
              }
            }}
            onmouseleave={(e) => {
              if (isDraggingVertex) handleVertexDragEnd(e);
              else handleShapeDragEnd(e);
            }}
            ondblclick={(e) => {
              if (linesDrawingMode === 'pointClick') {
                handleLinesDrawingDoubleClick(e);
              }
            }}
            oncontextmenu={(e) => {
              if (linesDrawingMode !== 'none') {
                handleLinesDrawingRightClick(e);
              }
            }}
            role="presentation"
          >
            <!-- Selection indicators and vertex handles for line elements -->
            {#if $selectedLinesLayer.linesContent}
              <svg class="shape-handles">
                {#each $selectedLinesLayer.linesContent.elements as element}
                  {@const isSelected = $selectedLinesLayer.linesContent.selectedElementId === element.id}
                  {@const centroid = getPolygonCentroid(element.shape.points)}
                  {@const screenX = canvasToSvgX(centroid.x)}
                  {@const screenY = canvasToSvgY(centroid.y)}
                  <!-- Selection bounding box -->
                  {#if isSelected && element.shape.points.length >= 2}
                    {@const minX = Math.min(...element.shape.points.map(v => v.x))}
                    {@const maxX = Math.max(...element.shape.points.map(v => v.x))}
                    {@const minY = Math.min(...element.shape.points.map(v => v.y))}
                    {@const maxY = Math.max(...element.shape.points.map(v => v.y))}
                    <rect
                      x={canvasToSvgX(minX) - 5}
                      y={canvasToSvgY(maxY) - 5}
                      width={(maxX - minX) * canvasWidth + 10}
                      height={(maxY - minY) * canvasHeight + 10}
                      fill="none"
                      stroke="#67E8F9"
                      stroke-width="2"
                      stroke-dasharray="5,5"
                    />
                    <!-- Center handle - draggable for moving the whole line -->
                    <circle
                      cx={screenX}
                      cy={screenY}
                      r="8"
                      fill="#67E8F9"
                      stroke="#fff"
                      stroke-width="2"
                      class="center-handle"
                      style="cursor: move; pointer-events: all;"
                      onmousedown={(e) => {
                        e.stopPropagation();
                        isDraggingShape = true;
                        const coords = mouseToCanvasCoords(e);
                        dragStartPos = { x: coords.x, y: coords.y };
                        dragStartShapePos = { x: centroid.x, y: centroid.y };
                        draggedElementId = element.id;
                        dragStartCustomVertices = null;
                      }}
                    >
                      <title>Drag to move line</title>
                    </circle>
                  {/if}
                {/each}

                <!-- Edit Points toggle button when line element is selected -->
                {#if $selectedLineElement}
                  {@const centroid = getPolygonCentroid($selectedLineElement.shape.points)}
                  <foreignObject
                    x={canvasToSvgX(centroid.x) - 50}
                    y={canvasToSvgY(centroid.y) + 30}
                    width="100"
                    height="28"
                  >
                    <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%;">
                      <button
                        class="warp-mode-btn"
                        onclick={() => { warpModeEnabled = !warpModeEnabled; }}
                        style="
                          background: {warpModeEnabled ? 'rgba(0, 255, 255, 0.3)' : 'rgba(60, 60, 60, 0.9)'};
                          border: 1px solid {warpModeEnabled ? '#00ffff' : '#666'};
                          color: {warpModeEnabled ? '#00ffff' : '#aaa'};
                          padding: 4px 10px;
                          border-radius: 12px;
                          font-size: 10px;
                          cursor: pointer;
                          width: 100%;
                          font-weight: {warpModeEnabled ? 'bold' : 'normal'};
                        "
                      >{warpModeEnabled ? 'Exit Edit' : 'Edit Points'}</button>
                    </div>
                  </foreignObject>
                {/if}

                <!-- Vertex handles for selected element - ONLY when edit mode is enabled -->
                {#if $selectedLineElement && warpModeEnabled && selectedVertices.length > 0}
                  <!-- Determine if line is closed (pointClick with closed=true) -->
                  {@const isClosedShape = $selectedLineElement.shape.type === 'pointClick' &&
                    'closed' in $selectedLineElement.shape && $selectedLineElement.shape.closed}
                  <polygon
                    points={selectedVertices.map(v => `${canvasToSvgX(v.x)},${canvasToSvgY(v.y)}`).join(' ')}
                    fill="none"
                    stroke="#00ffff"
                    stroke-width="1"
                    stroke-dasharray="4,4"
                    style="pointer-events: none;"
                  />

                  <!-- Edge midpoint handles for adding vertices -->
                  {#each selectedVertices as vertex, i}
                      {@const nextIdx = (i + 1) % selectedVertices.length}
                      {@const nextV = selectedVertices[nextIdx]}
                      {@const showEdge = isClosedShape || i < selectedVertices.length - 1}
                      {#if showEdge}
                        {@const midX = canvasToSvgX((vertex.x + nextV.x) / 2)}
                        {@const midY = canvasToSvgY((vertex.y + nextV.y) / 2)}
                        <circle
                          cx={midX}
                          cy={midY}
                          r="5"
                          fill="#333"
                          stroke="#67E8F9"
                          stroke-width="1.5"
                          class="add-vertex-handle"
                          style="cursor: pointer; pointer-events: all; opacity: 0.7;"
                          onmousedown={(e) => { e.stopPropagation(); addVertexToShape(i); }}
                        >
                          <title>Click to add vertex</title>
                        </circle>
                        <text
                          x={midX}
                          y={midY + 3}
                          text-anchor="middle"
                          fill="#67E8F9"
                          font-size="10"
                          font-weight="bold"
                          style="pointer-events: none;"
                        >+</text>
                      {/if}
                    {/each}

                  <!-- Vertex handles -->
                  {#each selectedVertices as vertex}
                    {@const vx = canvasToSvgX(vertex.x)}
                    {@const vy = canvasToSvgY(vertex.y)}
                    <circle
                      cx={vx}
                      cy={vy}
                      r="7"
                      fill="#00ffff"
                      stroke="#fff"
                      stroke-width="2"
                      class="vertex-handle"
                      style="cursor: move; pointer-events: all;"
                      onmousedown={(e) => handleVertexMouseDown(e, $selectedLineElement!.id, vertex.index, vertex.type)}
                      oncontextmenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (selectedVertices.length > 2) removeVertexFromShape(vertex.index);
                      }}
                    >
                      <title>Drag to move point, right-click to remove</title>
                    </circle>
                    <!-- Vertex number label -->
                    {#if selectedVertices.length <= 20}
                      <text
                        x={vx}
                        y={vy - 12}
                        text-anchor="middle"
                        fill="#00ffff"
                        font-size="10"
                        style="pointer-events: none;"
                      >
                        {vertex.index + 1}
                      </text>
                    {/if}
                  {/each}
                {/if}
              </svg>
            {/if}

            <!-- Lines drawing preview -->
            {#if isLinesDrawing && linesDrawingPoints.length > 0}
              <svg class="drawing-preview">
                <polyline
                  points={linesDrawingPoints.map(p => `${canvasToSvgX(p.x)},${canvasToSvgY(p.y)}`).join(' ')}
                  fill="none"
                  stroke="#ff00ff"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                {#if linesDrawingMode === 'pointClick'}
                  {#each linesDrawingPoints as point, i}
                    <circle
                      cx={canvasToSvgX(point.x)}
                      cy={canvasToSvgY(point.y)}
                      r="5"
                      fill="#ff00ff"
                      stroke="#fff"
                      stroke-width="2"
                    />
                    <text
                      x={canvasToSvgX(point.x)}
                      y={canvasToSvgY(point.y) - 10}
                      text-anchor="middle"
                      fill="#ff00ff"
                      font-size="11"
                    >
                      {i + 1}
                    </text>
                  {/each}
                {/if}
              </svg>
            {/if}

            {#if isDraggingShape}
              <div class="drag-hint">Dragging line...</div>
            {/if}
            {#if isDraggingVertex}
              <div class="drag-hint vertex-drag">Editing vertex...</div>
            {/if}
            {#if linesDrawingMode !== 'none'}
              <div class="drawing-mode-hint">
                {#if linesDrawingMode === 'freehand'}
                  Freehand: Click and drag to draw
                {:else if linesDrawingMode === 'pointClick'}
                  Polyline: Click to add points, double-click to finish
                {/if}
                <button class="cancel-btn" onclick={() => { linesDrawingMode = 'none'; isLinesDrawing = false; linesDrawingPoints = []; }}>
                  Cancel
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Mask editing overlay (multi-shape bezier pen tool) -->
        {#if $selectedLayer?.mask?.enabled}
          {@const maskShapes = $selectedLayer.mask.shapes ?? []}
          {@const maskHasClosedShape = maskShapes.some(s => s.closed)}
          <div
            class="mask-overlay"
            class:add-mode={maskPenMode === 'add'}
            class:remove-mode={maskPenMode === 'remove'}
            onmousedown={handleMaskMouseDown}
            onmousemove={handleMaskOverlayMouseMove}
            oncontextmenu={handleMaskOverlayContextMenu}
            role="presentation"
          >
            <svg class="mask-handles" style="width: 100%; height: 100%;">
              <!-- One <path> per sub-polygon. Closed shapes get a solid stroke and
                   light fill; the in-progress (open) shape gets a dashed stroke. -->
              {#each maskShapes as shape, sIdx}
                {#if shape.points.length >= 2}
                  <path
                    d={buildMaskShapePath(shape)}
                    fill={shape.closed ? 'rgba(255, 0, 255, 0.1)' : 'none'}
                    stroke="#ff00ff"
                    stroke-width="2"
                    stroke-dasharray={shape.closed ? 'none' : '4 4'}
                  />
                {/if}
                <!-- Per-anchor handle preview lines (only for closed shapes;
                     open-shape handles get rendered after pen draft). -->
                {#if shape.closed}
                  {#each shape.points as pt, pIdx}
                    {#if pt.cpIn}
                      <line
                        x1={canvasToSvgX(pt.x)} y1={canvasToSvgY(pt.y)}
                        x2={canvasToSvgX(pt.cpIn.x)} y2={canvasToSvgY(pt.cpIn.y)}
                        stroke="#ff00ff" stroke-width="1" opacity="0.6"
                      />
                    {/if}
                    {#if pt.cpOut}
                      <line
                        x1={canvasToSvgX(pt.x)} y1={canvasToSvgY(pt.y)}
                        x2={canvasToSvgX(pt.cpOut.x)} y2={canvasToSvgY(pt.cpOut.y)}
                        stroke="#ff00ff" stroke-width="1" opacity="0.6"
                      />
                    {/if}
                  {/each}
                {/if}
                <!-- Anchor dots + indices (for ALL anchors, open or closed) -->
                {#each shape.points as pt, pIdx}
                  {@const ax = canvasToSvgX(pt.x)}
                  {@const ay = canvasToSvgY(pt.y)}
                  {@const isDragging = draggingMaskAnchor?.shapeIndex === sIdx && draggingMaskAnchor?.pointIndex === pIdx}
                  {@const isCloseTarget = !shape.closed && pIdx === 0 && shape.points.length >= 3}
                  <!-- First anchor of an open shape with >=3 points is the
                       "click to close" target. Bigger + yellow rim so it's
                       obvious you can click it to finish the polygon. -->
                  {#if isCloseTarget}
                    <circle
                      cx={ax} cy={ay} r="13"
                      fill="none"
                      stroke="#ffd400"
                      stroke-width="2"
                      stroke-dasharray="3 3"
                      pointer-events="none"
                    />
                  {/if}
                  <circle
                    class="mask-anchor"
                    cx={ax}
                    cy={ay}
                    r="8"
                    fill={isDragging ? '#ff00ff' : (isCloseTarget ? '#ffd400' : '#fff')}
                    stroke={isCloseTarget ? '#ffd400' : '#ff00ff'}
                    stroke-width="2"
                    style="cursor: {isCloseTarget ? 'pointer' : 'grab'};"
                    onmousedown={(e) => handleMaskAnchorMouseDown(sIdx, pIdx, e)}
                    oncontextmenu={(e) => handleMaskAnchorRightClick(sIdx, pIdx, e)}
                    role="button"
                    tabindex="0"
                  />
                  <text
                    x={ax}
                    y={ay - 12}
                    text-anchor="middle"
                    fill="#ff00ff"
                    font-size="10"
                    font-weight="bold"
                    pointer-events="none"
                  >{pIdx + 1}</text>
                  <!-- cpIn / cpOut handle dots (only when a handle exists) -->
                  {#if pt.cpIn}
                    <circle
                      class="mask-handle"
                      cx={canvasToSvgX(pt.cpIn.x)}
                      cy={canvasToSvgY(pt.cpIn.y)}
                      r="5"
                      fill="#ff00ff"
                      stroke="#fff"
                      stroke-width="1.5"
                      style="cursor: grab;"
                      onmousedown={(e) => handleMaskHandleMouseDown(sIdx, pIdx, 'cpIn', e)}
                      role="button"
                      tabindex="0"
                    />
                  {/if}
                  {#if pt.cpOut}
                    <circle
                      class="mask-handle"
                      cx={canvasToSvgX(pt.cpOut.x)}
                      cy={canvasToSvgY(pt.cpOut.y)}
                      r="5"
                      fill="#ff00ff"
                      stroke="#fff"
                      stroke-width="1.5"
                      style="cursor: grab;"
                      onmousedown={(e) => handleMaskHandleMouseDown(sIdx, pIdx, 'cpOut', e)}
                      role="button"
                      tabindex="0"
                    />
                  {/if}
                {/each}
              {/each}

              <!-- Pen draft preview: in-progress anchor + handles -->
              {#if maskPenDraft}
                {@const anchorPx = maskPenDraft.anchorPx}
                {@const cpOutPx = maskPenDraft.dragPx}
                {@const cpInPx = { x: 2 * anchorPx.x - cpOutPx.x, y: 2 * anchorPx.y - cpOutPx.y }}
                <!-- Find the trailing open shape (if any) for the ghost-segment preview -->
                {@const openShapeForDraft = findOpenMaskShape(maskShapes)}
                {#if openShapeForDraft && openShapeForDraft.points.length > 0}
                  {@const lastPt = openShapeForDraft.points[openShapeForDraft.points.length - 1]}
                  {@const prevPx = { x: canvasToSvgX(lastPt.x), y: canvasToSvgY(lastPt.y) }}
                  {@const prevCpOutPx = lastPt.cpOut
                    ? { x: canvasToSvgX(lastPt.cpOut.x), y: canvasToSvgY(lastPt.cpOut.y) }
                    : prevPx}
                  <path
                    d={`M ${prevPx.x},${prevPx.y} C ${prevCpOutPx.x},${prevCpOutPx.y} ${cpInPx.x},${cpInPx.y} ${anchorPx.x},${anchorPx.y}`}
                    fill="none"
                    stroke="#ff00ff"
                    stroke-width="2"
                    stroke-dasharray={maskPenDraft.isCurve ? 'none' : '4 4'}
                    opacity="0.85"
                  />
                {/if}
                <!-- Handle bar + handle dots while in curve mode -->
                {#if maskPenDraft.isCurve}
                  <line
                    x1={cpInPx.x} y1={cpInPx.y}
                    x2={cpOutPx.x} y2={cpOutPx.y}
                    stroke="#ff00ff" stroke-width="1" opacity="0.7"
                  />
                  <circle cx={cpInPx.x} cy={cpInPx.y} r="4" fill="#ff00ff" stroke="#fff" stroke-width="1" />
                  <circle cx={cpOutPx.x} cy={cpOutPx.y} r="4" fill="#ff00ff" stroke="#fff" stroke-width="1" />
                {/if}
                <!-- Anchor preview dot, drawn last so it sits on top -->
                <circle cx={anchorPx.x} cy={anchorPx.y} r="6" fill="#fff" stroke="#ff00ff" stroke-width="2" />
              {/if}

              <!-- Add-mode edge hover indicator: green crosshair at the
                   insertion point so the user can SEE where the new anchor
                   will land before they click. -->
              {#if maskPenMode === 'add' && maskHoverEdgeIdx >= 0}
                <circle cx={maskHoverPx.x} cy={maskHoverPx.y} r="6" fill="none" stroke="#00ff88" stroke-width="2" />
                <line x1={maskHoverPx.x - 4} y1={maskHoverPx.y} x2={maskHoverPx.x + 4} y2={maskHoverPx.y} stroke="#00ff88" stroke-width="2" />
                <line x1={maskHoverPx.x} y1={maskHoverPx.y - 4} x2={maskHoverPx.x} y2={maskHoverPx.y + 4} stroke="#00ff88" stroke-width="2" />
              {/if}
            </svg>

            <!-- Pen-tool toolbar — only appears once at least one shape is
                 closed (modes only make sense for finished polygons). The
                 toolbar mirrors CustomShapeHandles' pen toolbar exactly so
                 users get the same UX between masks and custom shapes. -->
            {#if maskHasClosedShape}
              <div class="mask-pen-toolbar" role="toolbar" aria-label="Mask pen tool">
                <button
                  class="mask-pen-btn"
                  class:active={maskPenMode === 'edit'}
                  title="Select & Move"
                  onclick={(e) => { e.stopPropagation(); maskPenMode = 'edit'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                  </svg>
                </button>
                <button
                  class="mask-pen-btn"
                  class:active={maskPenMode === 'add'}
                  title="Add Point — click an edge to insert"
                  onclick={(e) => { e.stopPropagation(); maskPenMode = 'add'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20L8 4l4 10 6-2"/>
                    <line x1="16" y1="6" x2="16" y2="14"/>
                    <line x1="12" y1="10" x2="20" y2="10"/>
                  </svg>
                </button>
                <button
                  class="mask-pen-btn"
                  class:active={maskPenMode === 'remove'}
                  title="Remove Point — click an anchor to delete"
                  onclick={(e) => { e.stopPropagation(); maskPenMode = 'remove'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 20L8 4l4 10 6-2"/>
                    <line x1="12" y1="10" x2="20" y2="10"/>
                  </svg>
                </button>
                <span class="mask-pen-hint">
                  {#if maskPenMode === 'edit'}
                    Drag anchors. Right-click anchor to delete.
                  {:else if maskPenMode === 'add'}
                    Click an edge to insert a point.
                  {:else}
                    Click an anchor to remove it.
                  {/if}
                </span>
              </div>
            {/if}

            <div class="mask-hint">
              Click to add points · Drag to add curves · Right-click empty area to close shape · Right-click anchor to delete
            </div>
          </div>
        {/if}
        <!-- Drag-select box overlay -->
        {#if isDragSelecting && dragSelectStart && dragSelectCurrent}
          {@const x1 = Math.min(dragSelectStart.x, dragSelectCurrent.x)}
          {@const y1 = Math.min(dragSelectStart.y, dragSelectCurrent.y)}
          {@const x2 = Math.max(dragSelectStart.x, dragSelectCurrent.x)}
          {@const y2 = Math.max(dragSelectStart.y, dragSelectCurrent.y)}
          <div class="drag-select-box" style="
            left: {canvasOffsetX + x1 * canvasWidth}px;
            top: {canvasOffsetY + (1 - y2) * canvasHeight}px;
            width: {(x2 - x1) * canvasWidth}px;
            height: {(y2 - y1) * canvasHeight}px;
          "></div>
        {/if}
        </div><!-- End viewport-content -->

        <!-- Viewport info overlay (outside transform so it stays fixed) -->
        <div class="viewport-info">
          {$project.width} x {$project.height}
          {#if $selectedLayer}
            | {$selectedLayer.warpMode === 'mesh' ? 'Corner + Mesh' : 'Corner Warp'}
          {/if}
          {#if linesDrawingMode !== 'none'}
            | Drawing: {linesDrawingMode}
          {/if}
          {#if viewportZoom !== 1 || viewportPanX !== 0 || viewportPanY !== 0}
            | Zoom: {(viewportZoom * 100).toFixed(0)}%
            <button class="reset-view-btn" onclick={resetViewportTransform}>Reset View</button>
          {/if}
          <span class="grid-controls">
            <button
              class="grid-toggle-btn"
              class:active={$settings.ui.gridSettings?.enabled}
              onclick={() => settings.toggleGrid()}
              title="Toggle grid"
            >
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M0 4.5h14M0 9.5h14M4.5 0v14M9.5 0v14" stroke="currentColor" stroke-width="1" fill="none"/></svg>
            </button>
            {#if $settings.ui.gridSettings?.enabled}
              <select
                class="grid-size-select"
                value="{$settings.ui.gridSettings?.columns || 12}x{$settings.ui.gridSettings?.rows || 12}"
                onchange={(e) => {
                  const [c, r] = e.currentTarget.value.split('x').map(Number);
                  settings.setGridDimensions(c, r);
                }}
              >
                <option value="8x8">8×8</option>
                <option value="12x12">12×12</option>
                <option value="16x16">16×16</option>
                <option value="32x32">32×32</option>
                <option value="64x64">64×64</option>
              </select>
              <button
                class="snap-toggle-btn"
                class:active={$settings.ui.gridSettings?.snapToGrid}
                onclick={() => settings.toggleSnap()}
                title="Snap to grid"
              >
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 6h4l2-4 2 4h2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/></svg>
                Snap
              </button>
            {/if}
          </span>
        </div>

        <!-- Light Painting draw overlay (inside viewport for correct
             coordinates). Mount whenever the layer is selected — NOT
             just when drawing is enabled — so the path-edit handles
             can render in Edit mode too. The overlay panel itself
             self-disables pointer events when neither drawing nor
             path-editing is active so layer-level transform handles
             behind it keep working in normal Edit mode. -->
        {#if $selectedLightPaintingLayer}
          <LightPaintingPanel
            overlayOnly={true}
            viewportEl={viewportEl}
            {viewportPanX}
            {viewportPanY}
            {viewportZoom}
            {viewportWidth}
            {viewportHeight}
            {canvasOffsetX}
            {canvasOffsetY}
            {canvasWidth}
            {canvasHeight}
            drawingEnabled={lpDrawingEnabled}
            bind:isPathEditMode={lpIsPathEditMode}
            bind:pathEditTool={lpPathEditTool}
            bind:pathEditShowAllRawPoints={lpPathEditShowAllRawPoints}
          />
        {/if}
      </div>

      <!-- Right sidebar panel (always present to keep viewport size stable) -->
      <div class="right-sidebar">
        {#if $selectedLinesLayer}
          <LinesPanel />
        {:else if $selectedLightPaintingLayer}
          <LightPaintingPanel
            overlayOnly={false}
            viewportEl={viewportEl}
            {viewportPanX}
            {viewportPanY}
            {viewportZoom}
            {viewportWidth}
            {viewportHeight}
            {canvasOffsetX}
            {canvasOffsetY}
            {canvasWidth}
            {canvasHeight}
            bind:drawingEnabled={lpDrawingEnabled}
            bind:isPathEditMode={lpIsPathEditMode}
            bind:pathEditTool={lpPathEditTool}
            bind:pathEditShowAllRawPoints={lpPathEditShowAllRawPoints}
          />
        {:else if $selectedAdvLightPaintingLayer}
          <AdvLightPaintingPanel />
        {:else if $selectedTextLayer}
          <div class="text-panel-sidebar">
            <TextPanel />
          </div>
        {:else if $selectedSplatLayer}
          <div class="splat-panel-sidebar">
            <SplatPanel />
          </div>
        {:else if $selectedModel3DLayer}
          <div class="model3d-panel-sidebar">
            <Model3DPanel />
          </div>
        {:else if $selectedPixelFXLayer}
          <div class="pixel-fx-panel-sidebar">
            <PixelFXPanel />
          </div>
        {:else if $selectedGPULayer}
          <div class="gpu-layer-panel-sidebar">
            <GPULayerPanel />
          </div>
        {:else if $selectedSVGLayer}
          <SVGSourceTray embedded={true} />
        {:else if $selectedGroupLayer}
          <!-- Group layer: show media tray so user can assign a shader to the group -->
          <MediaTray embedded={true} />
        {:else if $selectedMediaLayer}
          {#if hasPluginControls}
            <div class="media-sidebar-tabs">
              <button
                class="media-sidebar-tab"
                class:active={mediaSidebarTab === 'plugin'}
                onclick={() => mediaSidebarTab = 'plugin'}
              >
                Plugin Controls
              </button>
              <button
                class="media-sidebar-tab"
                class:active={mediaSidebarTab === 'media'}
                onclick={() => mediaSidebarTab = 'media'}
              >
                Media
              </button>
            </div>
            {#if mediaSidebarTab === 'plugin'}
              <PluginLayerPanel source={selectedMediaSource} />
            {:else}
              <MediaTray embedded={true} />
            {/if}
          {:else}
            <MediaTray embedded={true} />
          {/if}
        {/if}
      </div>

    </main>

    <!-- Preset Tray at bottom (only in map mode) -->
    <PresetTray onBeforeLoad={(duration, type) => {
      const engine = canvasComponent?.getEngine();
      if (engine) engine.startTransition(duration, type);
    }} />

    <!-- Layer Sequencer (slide-up panel, next to Presets) -->
    <LayerSequencer />

    <!-- Keyframe Timeline (slide-up panel) -->
    <KeyframeTimeline />

    <!-- VJ Mode Panel (full screen overlay) -->
    <VJModePanel
      onFileAction={(action) => {
        if (action === 'new') newComposition();
        else if (action === 'open') loadComposition();
        else if (action === 'save') saveComposition();
        else if (action === 'saveAs') saveCompositionAs();
        else if (action === 'importPresets') importPresetsFromFile();
        else if (action === 'loadDemo') loadDemoProject();
        else if (action === 'undo') handleUndo();
        else if (action === 'redo') handleRedo();
      }}
    />

    <!-- VJ Live indicator & reopen button (when minimized) -->
    {#if $vjClipLauncher.isLive && !$vjClipLauncher.isOpen}
      <button class="vj-reopen-btn" onclick={() => vjClipLauncher.setOpen(true)}>
        <span class="live-dot-pulse"></span>
        VJ Live — Open Panel
      </button>
    {/if}

    <!-- Stage Designer overlay (fullscreen, z=999 — same pattern as
         VJModePanel). Mutual exclusion guaranteed by activeWorkspace
         setter in workspace.ts. -->
    {#if $workspace === 'stage'}
      <StageDesignerPanel />
    {/if}


    <!-- Offline render-to-video modal — opened from File →
         Render to Video. Owns its own progress + cancel + result
         state via the offlineRender store. -->
    <OfflineRenderModal
      isOpen={showOfflineRender}
      onClose={() => showOfflineRender = false}
    />

    <!-- Welcome Modal (first run) — EULA gate removed in OSS build. -->
    {#if showWelcome}
      <WelcomeModal onClose={() => {
        showWelcome = false;
        localStorage.setItem('ghostarcade-welcome-seen', 'true');
        // Welcome was the gate — kick off demo download once dismissed
        maybeAutoLoadDemo();
      }} />
    {/if}

    <!-- (Feature tour removed by request — see import comment.) -->

    <!-- Update available modal — shown when user clicks the Settings update
         banner. Handles download + install + auto-quit so the user never
         has to find the installer file themselves. -->
    {#if $updateModalOpen}
      <UpdateModal open={true} onClose={() => updateModalOpen.set(false)} />
    {/if}

    <!-- Demo download progress overlay — shown whenever loadDemoProject()
         is in flight, regardless of trigger source (auto-import or File menu).
         Indeterminate spinner instead of a percentage bar — GitHub asset
         downloads complete fast enough that the percentage often stayed at
         0 until the whole transfer finished, looking stuck. -->
    {#if demoLoading}
      <div class="demo-loading-overlay">
        <div class="demo-loading-card">
          <div class="demo-spinner" aria-hidden="true"></div>
          <h2>Loading demo project</h2>
          <p class="demo-loading-subtitle">Downloading sample composition + media (~107 MB)</p>
          <p class="demo-progress-hint">First-launch download — won't happen again</p>
        </div>
      </div>
    {/if}

    <!-- Settings Panel — output transforms now read from $settings.output -->
    <SettingsPanel
      isOpen={showSettings}
      onClose={() => showSettings = false}
    />

    <!-- Footer / Status bar -->
    <footer class="statusbar">
      <span>Project: {$project.name}</span>
      <span>Layers: {$project.layers.length}</span>
      {#if $selectedLayer}
        <span>Selected: {$selectedLayer.name}</span>
      {/if}
      {#if outputIsOpen}
        <span class="output-status">Output: Active</span>
      {/if}
      {#if $settings.output.blackout}
        <span class="blackout-status">BLACKOUT</span>
      {/if}
      {#if $settings.output.testPattern && $settings.output.testPattern !== 'none'}
        <span class="test-pattern-status">TEST: {$settings.output.testPattern}</span>
      {/if}
      <span class="spacer"></span>
      <span class="fps-counter" class:fps-good={$fpsStore > 50} class:fps-warn={$fpsStore >= 30 && $fpsStore <= 50} class:fps-bad={$fpsStore < 30 && $fpsStore > 0}>{$fpsStore} FPS</span>
      {#if versionInfo?.hasUpdate && versionInfo.releaseUrl}
        <!-- Update available — clickable badge that opens the release
             page. Replaces the version label with an actionable link
             so users immediately know an upgrade is available. -->
        <a
          class="version-label version-update"
          href={versionInfo.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="A newer version is available — click to download"
        >v{appVersion} → {versionInfo.latest}</a>
      {:else}
        <span class="version-label" title="Ghost Arcade v{appVersion}">v{appVersion}</span>
      {/if}
      <button class="shortcut-help-btn" onclick={() => showShortcutHelp = true} title="Keyboard Shortcuts (?)">?</button>
    </footer>
  </div>

  <!-- Output Window Manager — display transforms now flow via $settings.output
       broadcast to the output window, applied via CSS on its canvas. -->
  <OutputWindow
    bind:this={outputWindow}
    bind:isOpen={outputIsOpen}
    mainEngine={canvasComponent?.getEngine()}
    onClose={() => { outputIsOpen = false; outputMode = 'embedded'; settings.setOutputWindowOpen(false); }}
  />
{/if}

<!-- Keyboard Shortcut Help Overlay -->
<ShortcutsOverlay visible={showShortcutHelp} onClose={() => showShortcutHelp = false} />

<!-- Safe Mode in-app confirm popover (replaces window.confirm) -->
<ConfirmPopover />

<!-- Close Confirmation Modal -->
{#if showNewProjectModal}
  <div class="close-modal-backdrop" onclick={newProjectCancel}>
    <div class="close-modal" onclick={(e) => e.stopPropagation()}>
      <div class="close-modal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      </div>
      <h2 class="close-modal-title">New Composition</h2>
      <p class="close-modal-desc">Start a new project? Any unsaved changes will be lost.</p>
      <div class="close-modal-actions">
        <button class="close-modal-btn btn-save" onclick={newProjectConfirm}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Create New
        </button>
        <button class="close-modal-btn btn-cancel" onclick={newProjectCancel}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showCloseModal}
  <div class="close-modal-backdrop" onclick={closeModalCancel}>
    <div class="close-modal" onclick={(e) => e.stopPropagation()}>
      <div class="close-modal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h2 class="close-modal-title">Unsaved Changes</h2>
      <p class="close-modal-desc">Your project has unsaved changes that will be lost if you close without saving.</p>
      <div class="close-modal-actions">
        <button class="close-modal-btn btn-save" onclick={closeModalSave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Save &amp; Close
        </button>
        <button class="close-modal-btn btn-discard" onclick={closeModalDiscard}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Close Without Saving
        </button>
        <button class="close-modal-btn btn-cancel" onclick={closeModalCancel}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Crash Recovery Modal -->
{#if showRecoveryModal}
  <div class="close-modal-backdrop" onclick={discardAutosave}>
    <div class="close-modal" onclick={(e) => e.stopPropagation()}>
      <div class="close-modal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </div>
      <h2 class="close-modal-title">Recover Unsaved Project?</h2>
      <p class="close-modal-desc">An auto-saved project was found from {recoveryTimestamp}. Would you like to recover it?</p>
      <div class="close-modal-actions">
        <button class="close-modal-btn btn-recover" onclick={recoverAutosave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          Recover
        </button>
        <button class="close-modal-btn btn-discard" onclick={discardAutosave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Discard
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MIDI Edit Mode Overlay -->
<MidiOverlay />

<!-- Global loading overlay (blocks interaction during heavy operations) -->
<LoadingOverlay />
<ToastContainer />

<!-- Director AI Agent (disabled for this release) -->

<style>
  /* CSS Variables are set dynamically by applyColorScheme() in settings.ts */
  :global(:root) {
    /* Default fallback values (Midnight Coral theme) */
    --bg-primary: #0a0a0c;
    --bg-secondary: rgba(18, 18, 22, 0.95);
    --bg-tertiary: #141418;
    --bg-overlay: rgba(0, 0, 0, 0.85);
    --accent-primary: #FF6B6B;
    --accent-secondary: #FF8585;
    --accent-hover: #FF5252;
    --text-primary: #e8e8e8;
    --text-secondary: #a0a0a0;
    --text-muted: #666666;
    --border-primary: rgba(255, 107, 107, 0.15);
    --border-secondary: rgba(255, 255, 255, 0.06);
    --danger: #FF4757;
    --success: #2ED573;
    --warning: #FFA502;
  }

  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  /* Dark mode scrollbar styling */
  :global(*::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }
  :global(*::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(*::-webkit-scrollbar-thumb) {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
  }
  :global(*::-webkit-scrollbar-thumb:hover) {
    background: rgba(255, 255, 255, 0.15);
  }
  :global(*::-webkit-scrollbar-corner) {
    background: transparent;
  }

  /* Global select dropdown styling (remove stock browser arrow) */
  :global(select) {
    -webkit-appearance: none;
    appearance: none;
    background-color: #141418;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 6px center;
    background-size: 12px;
    padding: 5px 26px 5px 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #e0e0e0;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  :global(select:hover) {
    border-color: rgba(255, 255, 255, 0.2);
  }
  :global(select:focus) {
    outline: none;
    border-color: #BB86FC;
    box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.15);
  }
  :global(select option) {
    background: #1a1a22;
    color: #e0e0e0;
    padding: 4px 8px;
  }

  /* Global button base style */
  :global(button.btn-small) {
    background: rgba(187, 134, 252, 0.1);
    border: 1px solid rgba(187, 134, 252, 0.3);
    color: #BB86FC;
    font-size: 10px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    letter-spacing: 0.3px;
    transition: all 0.15s;
  }
  :global(button.btn-small:hover) {
    background: rgba(187, 134, 252, 0.2);
    border-color: #BB86FC;
  }

  /* Global details/summary styling for premium collapsible sections */
  :global(details) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  :global(details summary) {
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #999;
    padding: 8px 0 6px;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  :global(details summary::-webkit-details-marker) {
    display: none;
  }
  :global(details summary::before) {
    content: '▸';
    font-size: 10px;
    color: #666;
    transition: transform 0.15s;
  }
  :global(details[open] summary::before) {
    transform: rotate(90deg);
  }
  :global(details summary:hover) {
    color: #ccc;
  }
  :global(details[open] summary) {
    color: #bbb;
  }

  /* Global text input styling */
  :global(input[type="text"]) {
    background: #141418;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #e0e0e0;
    font-size: 11px;
    font-family: inherit;
    padding: 5px 8px;
    transition: border-color 0.15s;
  }
  :global(input[type="text"]:focus) {
    outline: none;
    border-color: #BB86FC;
    box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.15);
  }

  /* Global custom checkbox styling */
  :global(input[type="checkbox"]) {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #161618;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  :global(input[type="checkbox"]:checked) {
    background: #BB86FC;
    border-color: #BB86FC;
  }
  :global(input[type="checkbox"]:checked::after) {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 4px;
    height: 8px;
    border: solid #121212;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  :global(input[type="checkbox"]:hover) {
    border-color: #BB86FC;
  }

  /* Global range slider styles (all browsers) */
  :global(input[type="range"]) {
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: #000000;
    border-radius: 3px;
    cursor: pointer;
    outline: none;
  }
  :global(input[type="range"]::-webkit-slider-thumb) {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: #BB86FC;
    border-radius: 50%;
    cursor: pointer;
  }
  :global(input[type="range"]::-moz-range-track) {
    height: 6px;
    background: #000000;
    border-radius: 3px;
    border: none;
  }
  :global(input[type="range"]::-moz-range-thumb) {
    width: 14px;
    height: 14px;
    background: #BB86FC;
    border-radius: 50%;
    border: none;
    cursor: pointer;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg-secondary);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-secondary);
    height: 48px;
    position: relative;
    z-index: 1000;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-logo {
    height: 28px;
    width: auto;
    margin-right: 12px;
  }

  .version {
    font-size: 11px;
    color: #555;
    background: rgba(255, 255, 255, 0.04);
    padding: 2px 6px;
    border-radius: 3px;
  }

  /* ─── Integrated-GPU warning banner ───────────────────────────── */
  .gpu-warning-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.08));
    border-bottom: 1px solid rgba(245, 158, 11, 0.35);
    color: #fde68a;
    font-size: 12.5px;
    line-height: 1.4;
  }
  .gpu-warning-icon { flex: 0 0 auto; color: #fbbf24; display: flex; align-items: center; }
  .gpu-warning-body { flex: 1 1 auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
  .gpu-warning-body strong { color: #fef3c7; }
  .gpu-warning-detail { color: #fde68a; opacity: 0.9; }
  .gpu-warning-detail code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 5px;
    border-radius: 3px;
    color: #fef3c7;
  }
  .gpu-warning-link { color: #fbbf24; text-decoration: underline; font-weight: 600; }
  .gpu-warning-link:hover { color: #fde68a; }
  .gpu-warning-actions { flex: 0 0 auto; display: flex; gap: 6px; }
  .gpu-warning-dismiss {
    background: rgba(0, 0, 0, 0.25);
    color: #fef3c7;
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .gpu-warning-dismiss:hover { background: rgba(0, 0, 0, 0.4); border-color: rgba(245, 158, 11, 0.55); }
  .gpu-warning-dismiss.persist { background: rgba(245, 158, 11, 0.18); }
  .gpu-warning-dismiss.persist:hover { background: rgba(245, 158, 11, 0.3); }

  .gpu-indicator {
    font-size: 10px;
    color: #4caf50;
    background: rgba(76, 175, 80, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    margin-left: 6px;
    cursor: default;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .gpu-indicator.integrated {
    color: #ff9800;
    background: rgba(255, 152, 0, 0.15);
  }
  .gpu-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4caf50;
    display: inline-block;
  }
  .gpu-indicator.integrated .gpu-dot {
    background: #ff9800;
    animation: gpu-pulse 1.5s ease-in-out infinite;
  }
  @keyframes gpu-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* File Menu Dropdown */
  .file-menu-container {
    position: relative;
    margin-left: 16px;
    padding-left: 16px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  .file-menu-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    color: #aaa;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .file-menu-btn:hover,
  .file-menu-btn.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .file-menu-btn svg {
    width: 10px;
    height: 10px;
    transition: transform 0.15s;
  }

  .file-menu-btn.active svg {
    transform: rotate(180deg);
  }

  .file-menu-dropdown {
    position: absolute;
    top: 100%;
    left: 16px;
    margin-top: 4px;
    background: rgba(20, 20, 28, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    min-width: 200px;
    z-index: 1000;
    overflow: hidden;
  }

  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: #ccc;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }

  .menu-item:hover:not(:disabled) {
    background: rgba(187, 134, 252, 0.1);
  }

  .menu-item:disabled {
    color: #444;
    cursor: not-allowed;
  }

  .menu-icon {
    width: 16px;
    height: 16px;
    margin-right: 10px;
    flex-shrink: 0;
    color: #666;
  }

  .menu-item:hover:not(:disabled) .menu-icon {
    color: var(--accent-primary);
  }

  .menu-label {
    flex: 1;
  }

  .menu-shortcut {
    font-size: 10px;
    color: #555;
    margin-left: 16px;
  }

  .menu-separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
  }

  .menu-section-label {
    padding: 6px 12px 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
    font-weight: 600;
  }

  .menu-item-recent .menu-label {
    font-size: 12px;
  }

  .menu-label-truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }

  .menu-item-small .menu-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
  }

  .vj-preset-save {
    display: flex;
    gap: 6px;
    margin-left: 16px;
    padding-left: 16px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    align-items: center;
  }

  .vj-preset-input {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #eee;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 11px;
    width: 120px;
    transition: all 0.15s;
  }

  .vj-preset-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 12px rgba(187, 134, 252, 0.15);
  }

  .vj-preset-btn {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .vj-preset-btn:hover {
    background: linear-gradient(135deg, #CF6EFF, #50FF30);
    box-shadow: 0 0 16px rgba(57, 255, 20, 0.3);
  }

  .vj-preset-btn:active {
    transform: scale(0.98);
  }

  .toolbar-center {
    display: flex;
    gap: 4px;
    position: relative;
  }

  .output-btn {
    background: rgba(255, 255, 255, 0.04);
    color: #888;
    border: 1px solid transparent;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .output-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ddd;
  }

  .output-btn.active {
    background: rgba(187, 134, 252, 0.12);
    color: var(--accent-primary);
    border: 1px solid rgba(187, 134, 252, 0.3);
  }

  .output-btn.settings-btn {
    padding: 6px 10px;
    font-size: 14px;
  }

  .output-settings-popover {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(18, 18, 26, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 12px;
    margin-top: 8px;
    min-width: 240px;
    z-index: 1000;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .output-settings-popover .settings-header {
    font-weight: 600;
    font-size: 12px;
    color: var(--accent-primary);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .output-settings-popover .settings-section {
    margin-bottom: 12px;
  }

  .output-settings-popover .settings-section:last-child {
    margin-bottom: 0;
  }

  .output-settings-popover .settings-section > label {
    display: block;
    font-size: 11px;
    color: #777;
    margin-bottom: 6px;
  }

  .output-settings-popover .rotation-buttons {
    display: flex;
    gap: 4px;
  }

  .output-settings-popover .rotation-buttons button {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    color: #999;
    border: 1px solid transparent;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
  }

  .output-settings-popover .rotation-buttons button:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #eee;
  }

  .output-settings-popover .rotation-buttons button.active {
    background: rgba(187, 134, 252, 0.12);
    color: var(--accent-primary);
    border: 1px solid rgba(187, 134, 252, 0.3);
  }

  .output-settings-popover .crop-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .output-settings-popover .crop-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .output-settings-popover .crop-row span {
    font-size: 11px;
    color: #777;
    min-width: 20px;
  }

  .output-settings-popover .crop-row span.value {
    min-width: 35px;
    text-align: right;
  }

  .output-settings-popover .crop-row input[type="range"] {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    cursor: pointer;
  }

  .output-settings-popover .reset-crop {
    background: rgba(255, 255, 255, 0.04);
    color: #999;
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    margin-top: 4px;
  }

  .output-settings-popover .reset-crop:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #eee;
  }

  .output-settings-popover .cursor-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #bbb;
    cursor: pointer;
  }

  .output-settings-popover .cursor-toggle input[type="checkbox"] {
    cursor: pointer;
  }

  .output-settings-popover .cursor-hint {
    font-size: 10px;
    color: #555;
    margin-top: 4px;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
  }

  /* Recording button in header */
  .rec-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 68, 68, 0.08);
    border: 1px solid rgba(255, 68, 68, 0.2);
    color: #FF6B6B;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .rec-btn:hover {
    background: #FF6B6B;
    border-color: #FF6B6B;
    color: #fff;
  }

  .stop-rec-btn {
    background: #FF6B6B;
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .stop-rec-btn:hover {
    background: #FF8888;
  }

  .recording-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rec-dot {
    width: 8px;
    height: 8px;
    background: #FF6B6B;
    border-radius: 50%;
    animation: header-blink 1s infinite;
  }

  @keyframes header-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-time {
    font-size: 11px;
    font-weight: 600;
    color: #FF6B6B;
    font-family: monospace;
  }

  /* Freeze button in header */
  .freeze-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .freeze-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .freeze-btn.active {
    background: rgba(100, 180, 255, 0.15);
    border-color: rgba(100, 180, 255, 0.4);
    color: #64B4FF;
    box-shadow: 0 0 8px rgba(100, 180, 255, 0.2);
  }

  .freeze-btn.active:hover {
    background: rgba(100, 180, 255, 0.25);
    color: #8ECBFF;
  }

  /* Blackout button */
  .blackout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .blackout-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
  }
  .blackout-btn.active {
    background: rgba(255, 60, 60, 0.2);
    border-color: rgba(255, 60, 60, 0.5);
    color: #ff4444;
    box-shadow: 0 0 8px rgba(255, 60, 60, 0.3);
    animation: blackout-pulse 1.5s ease-in-out infinite;
  }
  @keyframes blackout-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  /* Test pattern button — same shape/size as blackout. Pulses orange
     when ON so the user can never wonder why their content isn't
     showing. Distinct color from blackout's red so the two states are
     unmistakable at a glance. */
  .testpattern-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .testpattern-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
  }
  .testpattern-btn.active {
    background: rgba(255, 165, 0, 0.22);
    border-color: rgba(255, 165, 0, 0.6);
    color: #ffb84a;
    box-shadow: 0 0 12px rgba(255, 165, 0, 0.55);
    animation: testpattern-pulse 1.2s ease-in-out infinite;
  }
  @keyframes testpattern-pulse {
    0%, 100% {
      box-shadow: 0 0 8px rgba(255, 165, 0, 0.4);
      background: rgba(255, 165, 0, 0.18);
    }
    50% {
      box-shadow: 0 0 18px rgba(255, 165, 0, 0.85), 0 0 4px rgba(255, 200, 80, 0.6) inset;
      background: rgba(255, 165, 0, 0.32);
    }
  }

  /* Screenshot button in header */
  .screenshot-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .screenshot-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .screenshot-btn:active {
    background: rgba(255, 107, 107, 0.15);
    color: #FF6B6B;
    border-color: rgba(255, 107, 107, 0.4);
  }

  /* Mic/Audio toggle button in header */
  .mic-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mic-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .mic-btn.active {
    background: rgba(46, 213, 115, 0.15);
    border-color: rgba(46, 213, 115, 0.4);
    color: #2ED573;
    box-shadow: 0 0 8px rgba(46, 213, 115, 0.2);
  }

  .mic-btn.active:hover {
    background: rgba(46, 213, 115, 0.25);
    color: #5AE08C;
  }

  .mic-active-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #2ED573;
    box-shadow: 0 0 6px #2ED57380;
    animation: mic-pulse 1.5s infinite;
  }

  /* Mic main button + device-picker chevron grouped as a single visual unit */
  .mic-btn-group {
    position: relative;
    display: inline-flex;
    align-items: stretch;
  }
  .mic-btn-group .mic-btn-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }
  .mic-btn-group .mic-btn-chevron {
    width: 16px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    padding: 0;
    color: #808080;
  }
  .mic-btn-group .mic-btn-chevron:hover {
    color: #e8e8e8;
  }

  .mic-picker {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    max-width: 320px;
    background: #1a1a1a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mic-picker-label {
    font-size: 10px;
    font-weight: 600;
    color: #808080;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 8px 2px;
  }
  .mic-picker-item {
    text-align: left;
    font-size: 12px;
    color: #d0d0d0;
    background: transparent;
    border: 1px solid transparent;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mic-picker-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
  }
  .mic-picker-item.selected {
    background: rgba(46, 213, 115, 0.12);
    border-color: rgba(46, 213, 115, 0.3);
    color: #2ED573;
  }
  .mic-picker-empty {
    padding: 8px;
    font-size: 11px;
    color: #707070;
    font-style: italic;
  }
  .mic-picker-hint {
    margin-top: 4px;
    padding: 6px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 10px;
    color: #808080;
    line-height: 1.4;
  }

  .mic-label {
    position: absolute;
    bottom: -1px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 6px;
    font-weight: 700;
    color: #2ED573;
    letter-spacing: 0.5px;
  }

  @keyframes mic-pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 6px #2ED57380; }
    50% { opacity: 0.6; box-shadow: 0 0 3px #2ED57340; }
  }

  /* VJ Button in header */
  .vj-btn {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .vj-btn:hover {
    background: linear-gradient(135deg, #CF6EFF, #50FF30);
    transform: scale(1.05);
    box-shadow: 0 0 20px rgba(57, 255, 20, 0.3);
  }

  /* Stage Designer button — sibling to VJ button, distinct cyan
     gradient so the user reads them as different workspaces at a
     glance. */
  .stage-btn {
    background: linear-gradient(135deg, #4cd1ff, #6f5cff);
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    margin-left: 6px;
  }
  .stage-btn:hover {
    background: linear-gradient(135deg, #80dfff, #8a7aff);
    transform: scale(1.05);
    box-shadow: 0 0 20px rgba(76, 209, 255, 0.3);
  }

  .settings-btn {
    background: rgba(255, 255, 255, 0.04);
    border: none;
    color: #666;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ddd;
  }

  .settings-btn svg {
    width: 18px;
    height: 18px;
  }

  .connection-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #777;
    background: rgba(255, 255, 255, 0.04);
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .connection-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ddd;
  }

  .connection-btn.connected {
    background: rgba(105, 240, 174, 0.1);
    color: #69F0AE;
  }

  .connection-btn .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #FF6B6B;
  }

  .connection-btn.connected .dot {
    background: #69F0AE;
  }

  .mobile-btn-wrapper {
    position: relative;
  }

  .mobile-info-popup {
    position: fixed;
    top: 56px;
    right: 16px;
    background: #12121a;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 16px;
    width: 340px;
    z-index: 999999;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
  }

  .mobile-info-popup h4 {
    margin-bottom: 12px;
    color: var(--accent-primary);
    text-align: center;
  }

  .mobile-info-popup p {
    font-size: 12px;
    color: #999;
    margin-bottom: 8px;
  }

  /* QR Code Styles */
  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    margin-bottom: 12px;
  }

  .qr-code {
    width: 200px;
    height: 200px;
    border-radius: 6px;
  }

  .qr-hint {
    margin-top: 8px;
    font-size: 11px;
    color: #666;
    text-align: center;
  }

  /* IP Selector */
  .ip-selector {
    margin-bottom: 12px;
  }

  .ip-selector label {
    display: block;
    font-size: 11px;
    color: #777;
    margin-bottom: 4px;
  }

  .ip-selector select {
    width: 100%;
    padding: 8px;
    background: #1a1a1e;
    border: 1px solid #444;
    border-radius: 6px;
    color: #eee;
    font-size: 13px;
  }

  /* Connection Details */
  .connection-details {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 12px;
  }

  .detail-row {
    display: flex;
    align-items: flex-start;
    margin-bottom: 6px;
  }

  .detail-row:last-child {
    margin-bottom: 0;
  }

  .detail-label {
    font-size: 11px;
    color: #777;
    width: 70px;
    flex-shrink: 0;
  }

  .detail-value {
    flex: 1;
    font-size: 11px;
    color: var(--accent-primary);
    word-break: break-all;
    background: transparent;
    padding: 0;
  }

  .mobile-info-popup .instructions {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    padding: 10px;
    margin-top: 12px;
  }

  .mobile-info-popup .instructions p {
    margin-bottom: 6px;
    color: #fff;
  }

  .mobile-info-popup .instructions ol {
    margin: 0;
    padding-left: 18px;
    font-size: 11px;
    color: #999;
  }

  .mobile-info-popup .instructions li {
    margin-bottom: 4px;
  }

  .mobile-info-popup .hint {
    font-size: 11px;
    color: #555;
  }

  .mobile-info-popup button {
    width: 100%;
    margin-top: 12px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 6px;
    color: #ddd;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mobile-info-popup button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .connection-error {
    background: rgba(255, 68, 68, 0.08);
    border: 1px solid rgba(255, 68, 68, 0.2);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    text-align: center;
  }

  .connection-error p {
    color: #FF8888;
    margin-bottom: 10px;
  }

  .retry-btn {
    background: #FF6B6B !important;
    color: #fff !important;
  }

  .retry-btn:hover {
    background: #FF8888 !important;
  }

  .connecting-status {
    background: rgba(187, 134, 252, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    text-align: center;
  }

  .connecting-status p {
    color: #999;
  }

  .connecting-status .hint {
    font-size: 11px;
    color: #666;
    margin-top: 8px;
  }

  .connecting-status code {
    background: rgba(187, 134, 252, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--accent-primary);
  }

  .connection-btn.error .dot {
    background: #FF6B6B;
  }

  /* Main Content */
  .main-content {
    flex: 1;
    display: flex;
    overflow: hidden;
    transition: margin-bottom 0.2s ease-out;
  }
  .main-content.kf-tray-open {
    margin-bottom: 300px; /* reflow above the keyframe tray */
  }

  .viewport {
    flex: 1;
    position: relative;
    background: #080808;
    overflow: hidden;
  }

  .viewport.panning {
    cursor: grabbing;
  }

  .viewport.space-ready {
    cursor: grab;
  }

  .viewport.space-ready.panning {
    cursor: grabbing;
  }

  .viewport-content {
    width: 100%;
    height: 100%;
    position: relative;
    will-change: transform;
  }

  .drag-select-box {
    position: absolute;
    border: 1px solid rgba(255, 107, 107, 0.6);
    background: rgba(255, 107, 107, 0.08);
    pointer-events: none;
    z-index: 45;
    border-radius: 2px;
  }

  .warp-handles-offset {
    position: absolute;
    pointer-events: none;
    z-index: 50;
  }
  /* Grid overlay sits above the WebGPU bridge (z-index 10) but below
     warp/multi-select handles so mapping interactions stay reachable. */
  .grid-overlay-offset {
    position: absolute;
    pointer-events: none;
    z-index: 15;
  }
  .multi-select-overlay {
    position: absolute;
    pointer-events: none;
    z-index: 49;
  }
  .multi-select-svg {
    display: block;
  }

  .layer-shape-warp-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    opacity: 0.78;
  }

  .layer-shape-warp-overlay.editing {
    opacity: 1;
  }

  .layer-shape-warp-overlay circle {
    pointer-events: all;
  }

  .viewport-info {
    position: fixed;
    bottom: 8px;
    left: 250px;
    background: rgba(10, 10, 14, 0.95);
    backdrop-filter: blur(8px);
    color: #666;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 6px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 50;
  }

  .reset-view-btn {
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #ccc;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
    margin-left: 4px;
  }

  .reset-view-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  /* Grid controls */
  .grid-controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    padding-left: 8px;
  }

  .grid-toggle-btn, .snap-toggle-btn {
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #888;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .grid-toggle-btn:hover, .snap-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ccc;
  }

  .grid-toggle-btn.active {
    background: rgba(0, 204, 255, 0.15);
    color: #00ccff;
  }

  .snap-toggle-btn.active {
    background: rgba(255, 170, 0, 0.15);
    color: #ffaa00;
  }

  .grid-size-select {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #aaa;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
  }

  /* VJ Reopen Button */
  .vj-reopen-btn {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgba(20, 20, 24, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 60, 60, 0.4);
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-reopen-btn:hover {
    background: rgba(255, 60, 60, 0.15);
    border-color: rgba(255, 60, 60, 0.6);
    color: #ff8888;
  }


  .live-dot-pulse {
    width: 8px;
    height: 8px;
    background: #ff3333;
    border-radius: 50%;
    animation: livePulse 1.5s infinite ease-in-out;
  }

  @keyframes livePulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 4px #ff3333; }
    50% { opacity: 0.4; box-shadow: 0 0 8px #ff3333; }
  }

  /* Status Bar */
  .statusbar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 6px 16px;
    background: rgba(12, 12, 16, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 11px;
    color: #555;
  }

  .statusbar .spacer {
    flex: 1;
  }

  .output-status {
    color: #69F0AE;
    font-weight: 600;
  }

  .blackout-status {
    color: #ff4444;
    font-weight: 700;
    animation: blackout-pulse 1.5s ease-in-out infinite;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .test-pattern-status {
    color: #FFD740;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
  }

  .fps-counter {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 11px;
    font-weight: 600;
    color: #888;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
  }
  .fps-counter.fps-good {
    color: #69F0AE;
  }
  .fps-counter.fps-warn {
    color: #FFD54F;
  }
  .fps-counter.fps-bad {
    color: #FF5252;
  }

  .version-label {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    /* Boosted from 10px/#444 — was nearly invisible. Now it's
       readable at a glance so users can verify what version they're
       on without squinting. */
    font-size: 12px;
    color: #999;
    background: rgba(255, 255, 255, 0.05);
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  /* Active when an upgrade is available — clickable, accent-colored,
     subtle pulse to attract attention without being intrusive. */
  .version-label.version-update {
    color: #BB86FC;
    text-decoration: none;
    background: rgba(187, 134, 252, 0.12);
    border-color: rgba(187, 134, 252, 0.4);
    cursor: pointer;
  }
  .version-label.version-update:hover {
    background: rgba(187, 134, 252, 0.24);
    color: #fff;
  }

  /* Shape Interaction Overlay for Lines Layers */
  .shape-interaction-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    cursor: pointer;
    z-index: 45;
  }

  .shape-interaction-overlay.drawing-active {
    cursor: crosshair;
  }

  .shape-handles {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .shape-handles .vertex-handle {
    pointer-events: all;
    cursor: move;
    transition: r 0.1s, fill 0.1s;
  }

  .shape-handles .warp-mode-btn {
    pointer-events: all;
  }

  .shape-handles foreignObject {
    pointer-events: all;
    overflow: visible;
  }

  .shape-handles .vertex-handle:hover {
    r: 9;
  }

  .shape-handles .center-handle {
    pointer-events: none;
  }

  .drag-hint {
    position: absolute;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(187, 134, 252, 0.15);
    color: var(--accent-primary);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    pointer-events: none;
  }

  .drag-hint.vertex-drag {
    background: rgba(105, 240, 174, 0.15);
    color: #69F0AE;
  }

  .drawing-mode-hint {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(57, 255, 20, 0.12);
    border: 1px solid rgba(57, 255, 20, 0.4);
    color: var(--accent-secondary);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .drawing-mode-hint .cancel-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(57, 255, 20, 0.4);
    color: var(--accent-secondary);
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .drawing-mode-hint .cancel-btn:hover {
    background: rgba(57, 255, 20, 0.2);
  }

  /* Drawing Overlay */
  .drawing-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    cursor: crosshair;
    z-index: 50;
  }

  .drawing-preview {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .drawing-hint {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(57, 255, 20, 0.12);
    border: 1px solid rgba(57, 255, 20, 0.4);
    color: var(--accent-secondary);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    pointer-events: none;
  }

  /* Mask Overlay */
  .mask-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    cursor: crosshair;
    z-index: 55;
  }

  .mask-handles {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
  }

  .mask-handles circle {
    transition: fill 0.1s ease;
  }

  .mask-handles circle:hover {
    fill: var(--accent-secondary);
  }

  .mask-hint {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(57, 255, 20, 0.12);
    border: 1px solid rgba(57, 255, 20, 0.4);
    color: var(--accent-secondary);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
  }

  /* Mask pen tool overrides the crosshair cursor for non-edit modes so the
     user has a visual cue that left-click does something different. */
  .mask-overlay.add-mode { cursor: copy; }
  .mask-overlay.remove-mode { cursor: not-allowed; }

  /* Pen toolbar overlay — mirrors CustomShapeHandles.pen-toolbar styles
     so masks and custom shapes have the same look. Positioned at the top
     center of the mask overlay so it doesn't overlap the bottom hint. */
  .mask-pen-toolbar {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(255, 0, 255, 0.4);
    border-radius: 6px;
    padding: 3px 8px;
    pointer-events: auto;
    z-index: 60;
  }
  .mask-pen-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: #aaa;
    cursor: pointer;
    padding: 0;
  }
  .mask-pen-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .mask-pen-btn.active {
    background: rgba(255, 0, 255, 0.2);
    border-color: #ff00ff;
    color: #ff00ff;
  }
  .mask-pen-hint {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
    user-select: none;
    margin-left: 6px;
  }

  .text-panel-sidebar {
    width: 100%;
    background: #111114;
    overflow-y: auto;
    flex: 1;
  }

  .splat-panel-sidebar {
    width: 100%;
    background: #111114;
    overflow-y: auto;
    flex: 1;
  }

  .model3d-panel-sidebar {
    width: 100%;
    background: #111114;
    overflow-y: auto;
    flex: 1;
  }

  .media-sidebar-tabs {
    display: flex;
    gap: 4px;
    padding: 8px;
    background: #111114;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .media-sidebar-tab {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #888;
    padding: 7px 8px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .media-sidebar-tab:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ddd;
  }

  .media-sidebar-tab.active {
    background: rgba(187, 134, 252, 0.16);
    border-color: rgba(187, 134, 252, 0.4);
    color: var(--accent-primary);
  }

  .right-sidebar {
    width: 260px;
    flex-shrink: 0;
    background: #0d0d10;
    border-left: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ─── Close Confirmation Modal ─── */
  .close-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease-out;
  }

  .close-modal {
    background: linear-gradient(145deg, #1a1a20, #141418);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 32px 36px;
    width: 420px;
    max-width: 90vw;
    text-align: center;
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.05),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    animation: modalSlideIn 0.2s ease-out;
  }

  .close-modal-icon {
    margin-bottom: 16px;
    display: flex;
    justify-content: center;
  }

  .close-modal-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
    letter-spacing: -0.01em;
  }

  .close-modal-desc {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 28px;
  }

  .close-modal-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .close-modal-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 20px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .close-modal-btn.btn-save {
    background: var(--accent-primary);
    color: #fff;
    border-color: var(--accent-primary);
  }
  .close-modal-btn.btn-save:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(255, 107, 107, 0.3);
  }

  .close-modal-btn.btn-discard {
    background: rgba(255, 71, 87, 0.1);
    color: var(--danger);
    border-color: rgba(255, 71, 87, 0.25);
  }
  .close-modal-btn.btn-discard:hover {
    background: rgba(255, 71, 87, 0.2);
    border-color: rgba(255, 71, 87, 0.4);
  }

  .close-modal-btn.btn-cancel {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-secondary);
    border-color: rgba(255, 255, 255, 0.08);
  }
  .close-modal-btn.btn-cancel:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .close-modal-btn.btn-recover {
    background: #4ecdc4;
    color: #fff;
    border-color: #4ecdc4;
  }
  .close-modal-btn.btn-recover:hover {
    background: #45b7af;
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(78, 205, 196, 0.3);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* ─── Shortcut Help Button (statusbar) ─── */
  .shortcut-help-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #999;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
    line-height: 1;
    padding: 0;
  }
  .shortcut-help-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
    border-color: rgba(255, 255, 255, 0.2);
  }
  .director-toolbar-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
    padding: 0;
  }
  .director-toolbar-btn:hover {
    background: rgba(232, 67, 147, 0.12);
    border-color: rgba(232, 67, 147, 0.3);
  }
  .director-footer-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    width: 22px;
    height: 22px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
    padding: 0;
  }
  .director-footer-btn:hover {
    background: rgba(232, 67, 147, 0.12);
    border-color: rgba(232, 67, 147, 0.3);
  }

  /* ─── Keyboard Shortcut Help Overlay ─── */
  .shortcut-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease-out;
  }

  .shortcut-overlay {
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 28px 32px 32px;
    max-width: 600px;
    width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    animation: modalSlideIn 0.2s ease-out;
  }

  .shortcut-overlay-close {
    position: absolute;
    top: 12px;
    right: 16px;
    background: none;
    border: none;
    color: #666;
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  .shortcut-overlay-close:hover {
    color: #e8e8e8;
    background: rgba(255, 255, 255, 0.08);
  }

  .shortcut-overlay-title {
    font-size: 18px;
    font-weight: 600;
    color: #e8e8e8;
    margin: 0 0 24px 0;
    letter-spacing: -0.01em;
  }

  .shortcut-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 24px;
  }

  .shortcut-section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #999;
    margin: 0 0 12px 0;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
    color: #e8e8e8;
  }

  .shortcut-row span {
    color: #999;
    white-space: nowrap;
  }

  .shortcut-overlay kbd {
    display: inline-block;
    background: #2a2a30;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    color: #ccc;
    line-height: 1.3;
    min-width: 20px;
    text-align: center;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* ─── Demo download overlay ──────────────────────────────────────── */
  .demo-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .demo-loading-card {
    background: #14141a;
    border: 1px solid rgba(255, 133, 119, 0.15);
    border-radius: 8px;
    padding: 32px 36px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    text-align: center;
  }

  .demo-loading-card h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 6px 0;
    color: #fff;
  }

  .demo-loading-subtitle {
    font-size: 13px;
    color: #888;
    margin: 0 0 14px 0;
  }

  .demo-spinner {
    width: 36px;
    height: 36px;
    margin: 0 auto 18px;
    border: 3px solid rgba(255, 255, 255, 0.08);
    border-top-color: #FF8577;
    border-right-color: #7EC8E3;
    border-radius: 50%;
    animation: demo-spin 0.9s linear infinite;
  }

  @keyframes demo-spin {
    to { transform: rotate(360deg); }
  }

  .demo-progress-hint {
    font-size: 11px;
    color: #666;
    font-style: italic;
    margin: 0;
  }

</style>
