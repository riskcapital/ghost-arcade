<script lang="ts">
  /**
   * Ghost Stage — 3D stage designer panel.
   *
   * Top bar:    tool segment (move/rotate/scale), snap, undo/redo,
   *             venue picker, PA preset dropdown, top/frame/save/load/clear.
   * Left rail:  element library (Stage / Lighting / Audio groups).
   * Right rail: inspector for the selected screen or element.
   *
   * LED screens auto-sync from the project's screen layers; everything
   * else is user-placed via the library. Press H to hide all panels.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    stage3dScene,
    selectedStage3DNodeId,
    selectedStage3DTargets,
    stage3DGizmoMode,
    stage3DRendererControls,
    stage3DCameraFov,
    stage3DSceneryList,
    historyVersion,
    parseSelection,
    setStage3DSelection,
    toggleStage3DSelection,
    setStage3DMultiSelection,
  } from '../../stage3d/store';
  import { project } from '../../stores/layers';
  import { migrateStageLayerCorners } from '../../utils/stageTextureOrientation';
  import { ELEMENT_TYPES, makeUserElement } from '../../stage3d/elementTypes';
  import { buildNativeStage3DScene } from '../../stage3d/nativeSceneBridge';
  import { buildVenue, paPresetElements, type PAPreset } from '../../stage3d/venues';
  import { DEFAULT_ATMOSPHERE, DEFAULT_LIGHTING, type Stage3DScene, type Stage3DVenue, type UserStageElement } from '../../stage3d/types';
  import type { Layer } from '../../types';
  import { startRecording as startCanvasRecording, formatRecordingDuration, type RecorderHandle } from '../../recording/recorder';
  import {
    startNativeLiveFrameRecording,
    startNativeRendererLiveFrameRecording,
  } from '../../recording/nativeLiveFrameRecorder';
  import { getNativeRendererCapabilities, setNativeRendererStage3DScene } from '../../api/native-renderer';
  import { invoke, isDesktopApp } from '../../bridge';
  import StageNodeProperties from './StageNodeProperties.svelte';
  import StageElementProperties from './StageElementProperties.svelte';
  import StageLightingPanel from './StageLightingPanel.svelte';
  import DemoReelPanel from './DemoReelPanel.svelte';

  /** When false, this component renders only the floating UI overlay;
   *  the viewport comes from Canvas.svelte's stage3DOutput mode. */
  export let renderViewport = true;
  export let onClose: () => void;

  let snapOn = false;
  let toastMessage = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let panelsHidden = false;
  let recorderHandle: RecorderHandle | null = null;
  let recordingDuration = 0;
  let isRecording = false;
  let reelOpen = false;
  let stageFullscreen = false;
  let fullscreenBusy = false;
  let panelsWereHiddenBeforeFullscreen = false;
  let removeStageFullscreenListener: (() => void) | null = null;
  let removeDomFullscreenListener: (() => void) | null = null;
  // Stage recordings are always a clean 16:9, independent of the project's
  // output resolution (a wide 4000×1080 comp still records 1920×1080 / 4K).
  const REC_RES = {
    '1080': { w: 1920, h: 1080, label: '1080p' },
    '4k':   { w: 3840, h: 2160, label: '4K' },
  } as const;
  let recRes: keyof typeof REC_RES = '1080';
  let nativeScenePublishTimer: ReturnType<typeof setTimeout> | null = null;
  let nativeScenePublishWarnings = 0;
  let screenLayers: Layer[] = [];

  function queueNativeStageScene(scene: Stage3DScene, layers = screenLayers) {
    if (!isDesktopApp) return;
    if (nativeScenePublishTimer) clearTimeout(nativeScenePublishTimer);
    nativeScenePublishTimer = setTimeout(() => {
      nativeScenePublishTimer = null;
      const nativeScene = buildNativeStage3DScene(scene, layers);
      void setNativeRendererStage3DScene(nativeScene).catch((err) => {
        if (nativeScenePublishWarnings < 3) {
          console.warn('[Stage3D] native scene bridge unavailable:', err);
          nativeScenePublishWarnings++;
        }
      });
    }, 220);
  }

  // Refresh undo/redo button state whenever historyVersion bumps.
  let canUndo = false;
  let canRedo = false;
  $: { void $historyVersion; const c = stage3dScene.getHistoryCounts(); canUndo = c.past > 0; canRedo = c.future > 0; }
  $: screenLayers = $project.layers.filter(l => l.type === 'screen' && l.visible !== false);
  // Live native-scene publishing removed: the 3D window renders via WebGL.
  // Publishing the scene into the shared core overlays the venue onto the
  // 2D output for as long as the window is open. The native recording flow
  // sets the scene explicitly per frame and clears it afterwards.
  $: userElements = $stage3dScene.userElements ?? [];
  $: venue = ($stage3dScene.venue ?? 'festival') as Stage3DVenue;
  // Venue scenery pieces (deck, trusses, movers, PA…) the renderer
  // discovered for the current venue, plus their per-piece override so
  // the tree can show deleted/moved state and offer restore.
  $: sceneryItems = $stage3DSceneryList;
  $: sceneryOverrides = $stage3dScene.sceneryOverrides ?? {};

  function deleteScenery(id: string) {
    stage3dScene.setSceneryOverride(id, { deleted: true });
    setStage3DSelection(null);
    toast('Venue piece hidden');
  }
  function restoreScenery(id: string) {
    // null clears the whole override → piece returns to baseline
    // transform AND visibility.
    stage3dScene.setSceneryOverride(id, null);
    toast('Venue piece restored');
  }
  $: selection = parseSelection($selectedStage3DNodeId);
  $: selectedScreen = selection?.kind === 'screen'
    ? screenLayers.find(l => l.id === selection!.id) : null;
  $: selectedElement = selection?.kind === 'element'
    ? userElements.find(e => e.id === selection!.id) : null;
  $: selectedScenery = selection?.kind === 'scenery'
    ? (sceneryItems.find(s => s.id === selection!.id) ?? null)
    : null;
  let sphereInspectorTab: 'screen' | 'room' = 'screen';
  $: sphereScreenLayer = selectedScreen ?? screenLayers[0] ?? null;
  $: if (venue === 'sphere' && sphereInspectorTab === 'screen' && !sphereScreenLayer) {
    sphereInspectorTab = 'room';
  }

  function showSphereScreenInspector() {
    const layer = selectedScreen ?? screenLayers[0] ?? null;
    if (!layer) return;
    sphereInspectorTab = 'screen';
    setStage3DSelection(`screen:${layer.id}`);
  }

  function showSphereRoomInspector() {
    sphereInspectorTab = 'room';
  }

  function hasStageAdditions(scene = $stage3dScene): boolean {
    return (scene.userElements?.length ?? 0) > 0
      || Object.keys(scene.sceneryOverrides ?? {}).length > 0
      || Object.keys(scene.screenOverrides ?? {}).length > 0;
  }

  function setVenue(v: Stage3DVenue) {
    const current = get(stage3dScene);
    const currentVenue = (current.venue ?? 'festival') as Stage3DVenue;
    if (v === currentVenue) return;

    const keepAdditions = hasStageAdditions(current)
      ? confirm(`Keep your placed elements and 3D edits when switching to ${v}?\n\nOK = Keep additions\nCancel = Clear for a clean venue`)
      : false;

    if (keepAdditions) {
      stage3dScene.setVenue(v);
      toast(`Venue: ${v} · additions kept`);
      return;
    }

    stage3dScene.loadScene({
      ...current,
      venue: v,
      userElements: [],
      sceneryOverrides: {},
      screenOverrides: {},
    });
    setStage3DSelection(null);
    toast(`Venue: ${v} · clean`);
  }

  function addElement(type: string) {
    const def = ELEMENT_TYPES[type];
    if (!def) return;
    const el = makeUserElement(type);
    // Lighting placed at ~9m so it spawns near the rig height, others
    // on the ground. Position roughly under the camera target instead
    // of (0, 0, 0) so multiple adds don't stack.
    el.position = [0, def.group === 'Lighting' ? 9 : 0, 0];
    stage3dScene.addUserElement(el);
    setStage3DSelection(`element:${el.id}`);
    toast(`${def.label} added`);
  }

  function applyPAPreset(kind: PAPreset) {
    const venueBuild = buildVenue(venue);
    const elements = paPresetElements(kind, venueBuild);
    for (const el of elements) stage3dScene.addUserElement(el);
    toast(`PA preset added`);
  }

  let onPASelect: (e: Event) => void;
  onPASelect = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) return;
    applyPAPreset(v as PAPreset);
    (e.target as HTMLSelectElement).value = '';
  };

  function setGizmoMode(mode: 'translate' | 'rotate' | 'scale') {
    stage3DGizmoMode.set(mode);
  }

  function toggleSnap() {
    snapOn = !snapOn;
    $stage3DRendererControls?.setSnap(snapOn);
  }

  function clearElements() {
    if (!userElements.length) return;
    if (confirm(`Clear all ${userElements.length} placed elements?`)) {
      stage3dScene.clearUserElements();
      setStage3DSelection(null);
      toast('Cleared');
    }
  }

  /** Save the whole Ghost Stage design — 3D scene PLUS the project's
   *  screen layers + surface slices so loading the file later restores
   *  both the 3D viewport AND the matching 2D mapper layout. Other
   *  project layers (videos, shaders, etc.) are left out so loading a
   *  stage into a different project doesn't blow away unrelated work. */
  function saveDesign() {
    const proj = $project;
    const screenLayers = proj.layers.filter(l => l.type === 'screen');
    const bundle = {
      format: 'ghost-stage',
      version: 1,
      name: proj.name ?? 'Untitled Stage',
      savedAt: Date.now(),
      stage3d: JSON.parse(stage3dScene.exportJSON()),
      project: {
        name: proj.name,
        width: proj.width,
        height: proj.height,
        screenLayers,
        surfaces: proj.surfaces ?? [],
      },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(proj.name || 'stage-design').replace(/[^a-z0-9-_ ]/gi, '_')}.ghost-stage.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Stage saved');
  }

  let fileInput: HTMLInputElement;
  let modelImportInput: HTMLInputElement;
  function loadDesign() { fileInput?.click(); }
  function onFileChosen(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = rd.result as string;
      const ok = applyStageBundle(text);
      toast(ok ? 'Stage loaded' : 'Invalid file');
    };
    rd.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  /** Apply a saved bundle. Falls back to the legacy `.stage.json` shape
   *  (just a Stage3DScene) for files saved before the bundling work. */
  function applyStageBundle(text: string): boolean {
    try {
      const data = JSON.parse(text);
      // Modern bundle: replace 3D + merge screen layers into project.
      if (data?.format === 'ghost-stage' && data.stage3d) {
        stage3dScene.loadScene(data.stage3d);
        if (data.project?.screenLayers) {
          project.update(p => ({
            ...p,
            // Replace screens but keep every non-screen layer the user
            // already has (videos, shaders, lights, etc.).
            layers: [
              ...p.layers.filter(l => l.type !== 'screen'),
              ...data.project.screenLayers.map(migrateStageLayerCorners),
            ],
            surfaces: Array.isArray(data.project.surfaces) && data.project.surfaces.length
              ? data.project.surfaces
              : p.surfaces,
          }));
        }
        return true;
      }
      // Legacy: bare Stage3DScene.
      return stage3dScene.importJSON(text);
    } catch {
      return false;
    }
  }

  function blankSlate() {
    const current = get(stage3dScene);
    const ok = !hasStageAdditions(current) || confirm('Start with a blank room? This clears placed elements and 3D venue edits.');
    if (!ok) return;
    stage3dScene.loadScene({
      ...current,
      venue: 'empty',
      basePreset: 'empty',
      userElements: [],
      sceneryOverrides: {},
      screenOverrides: {},
      lighting: { ...DEFAULT_LIGHTING },
      atmosphere: { ...DEFAULT_ATMOSPHERE },
    });
    setStage3DSelection(null);
    toast('Blank room ready');
  }

  function triggerModelImport() {
    modelImportInput?.click();
  }

  function onModelImportChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['glb', 'gltf', 'obj'].includes(ext)) {
      toast('Use GLB, GLTF, or OBJ');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const el = makeUserElement('importedmodel', {
        modelData: String(reader.result ?? ''),
        modelName: file.name,
        modelFormat: ext,
        modelScale: 8,
        vjSource: 'master',
      });
      el.position = [0, 0, 0];
      stage3dScene.addUserElement(el);
      setStage3DSelection(`element:${el.id}`);
      toast(`Imported ${file.name}`);
    };
    reader.onerror = () => toast('Import failed');
    reader.readAsDataURL(file);
    input.value = '';
  }

  function toast(msg: string) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = ''), 1600);
  }

  async function startStageRecording() {
    if (recorderHandle) return;
    const controls = $stage3DRendererControls;
    const res = REC_RES[recRes];
    if (!controls) { toast('Stage renderer not ready'); return; }

    if (isDesktopApp) {
      recordingDuration = 0;
      try {
        const caps = await getNativeRendererCapabilities();
        const nativeStageReady = !!(
          caps?.core_capabilities_confirmed &&
          caps?.features?.native_stage3d &&
          caps?.features?.native_stage3d_recording_parity &&
          caps?.features?.native_recording &&
          caps?.features?.frame_snapshot_export &&
          caps?.implemented_methods?.includes('set_stage3d_scene') &&
          caps?.implemented_methods?.includes('export_frame_snapshot')
        );
        if (nativeStageReady) {
          recorderHandle = await startNativeRendererLiveFrameRecording({
            width: res.w,
            height: res.h,
            fps: 30,
            quality: 'high',
            namePrefix: 'Stage Recording',
            prepareFrame: async () => {
              const nativeScene = buildNativeStage3DScene(get(stage3dScene), get(project).layers, {
                camera: controls.getCameraState(),
              });
              await setNativeRendererStage3DScene(nativeScene);
            },
            restore: async () => {
              await setNativeRendererStage3DScene(null);
            },
            onDurationUpdate: (s) => { recordingDuration = s; },
            onComplete: () => {
              isRecording = false;
              recorderHandle = null;
              toast('Stage recording saved');
            },
            onError: (err) => {
              isRecording = false;
              recorderHandle = null;
              toast(err.message || 'Recording failed');
            },
          });
          if (recorderHandle) {
            isRecording = true;
            toast(`Stage recording started · ${res.label} native renderer`);
            return;
          }
        }
      } catch (err) {
        console.warn('[Stage3D] Native renderer recording unavailable, falling back to live canvas capture:', err);
      }

      try {
        recorderHandle = await startNativeLiveFrameRecording({
          captureFrame: (width, height) => controls.captureFrameAt(width, height),
          width: res.w,
          height: res.h,
          fps: 30,
          quality: 'high',
          namePrefix: 'Stage Recording',
          onDurationUpdate: (s) => { recordingDuration = s; },
          onComplete: () => {
            isRecording = false;
            recorderHandle = null;
            toast('Stage recording saved');
          },
          onError: (err) => {
            isRecording = false;
            recorderHandle = null;
            toast(err.message || 'Recording failed');
          },
        });
        if (recorderHandle) {
          isRecording = true;
          toast(`Stage recording started · ${res.label} native`);
          return;
        }
      } catch (err) {
        console.warn('[Stage3D] Native recording unavailable, falling back to MediaRecorder:', err);
      }
    }

    // Render into a fixed 16:9 offscreen canvas (decoupled from the
    // project's output resolution) and record THAT — so a wide comp
    // still produces a clean 1080p / 4K file.
    const recordCanvas = controls.beginRecording(res.w, res.h) ?? null;
    if (!recordCanvas) { toast('Stage renderer not ready'); return; }
    recordingDuration = 0;
    recorderHandle = startCanvasRecording({
      namePrefix: 'Stage Recording',
      canvas: recordCanvas,
      onDurationUpdate: (s) => { recordingDuration = s; },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
        controls?.endRecording();
        toast('Stage recording saved');
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        controls?.endRecording();
        toast(err.message || 'Recording failed');
      },
    });
    if (recorderHandle) {
      isRecording = true;
      toast(`Stage recording started · ${res.label}`);
    } else {
      controls?.endRecording();
    }
  }

  function stopStageRecording() {
    if (!recorderHandle) return;
    recorderHandle.stop();
    recorderHandle = null;
    isRecording = false;
  }

  function toggleStageRecording() {
    if (isRecording) stopStageRecording();
    else void startStageRecording();
  }

  // Library grouped by category.
  $: libraryGroups = (() => {
    const groups: Record<string, [string, typeof ELEMENT_TYPES[string]][]> = {};
    for (const [type, def] of Object.entries(ELEMENT_TYPES)) {
      (groups[def.group] = groups[def.group] || []).push([type, def]);
    }
    return ['Stage', 'Visual', 'FX', 'Lighting', 'Audio'].map(g => ({ name: g, items: groups[g] ?? [] }));
  })();

  function undo() { stage3dScene.undo(); }
  function redo() { stage3dScene.redo(); }
  function togglePanels() { panelsHidden = !panelsHidden; }

  function syncStageFullscreen(fullScreen: boolean) {
    const next = !!fullScreen;
    if (next && !stageFullscreen) {
      panelsWereHiddenBeforeFullscreen = panelsHidden;
      panelsHidden = true;
    }
    stageFullscreen = next;
    if (!next && !panelsWereHiddenBeforeFullscreen) panelsHidden = false;
  }

  async function setStageFullscreen(next: boolean) {
    if (fullscreenBusy) return;
    fullscreenBusy = true;
    if (next) {
      panelsWereHiddenBeforeFullscreen = panelsHidden;
      panelsHidden = true;
    }

    try {
      let applied = false;
      if (isDesktopApp) {
        try {
          const result = await invoke<{ ok?: boolean; fullScreen?: boolean }>('stage3d_set_fullscreen', { fullScreen: next });
          if (result?.ok) {
            syncStageFullscreen(!!result.fullScreen);
            applied = true;
          }
        } catch {
          applied = false;
        }
      }

      if (!applied) {
        const target = document.querySelector('.stage3d-root') as HTMLElement | null;
        if (next) {
          if (!target?.requestFullscreen) throw new Error('Fullscreen unavailable');
          await target.requestFullscreen();
          syncStageFullscreen(!!document.fullscreenElement);
        } else if (document.fullscreenElement) {
          await document.exitFullscreen();
          syncStageFullscreen(false);
        } else {
          syncStageFullscreen(false);
        }
      }

      toast(next ? 'Stage fullscreen' : 'Exited fullscreen');
    } catch {
      if (next && !panelsWereHiddenBeforeFullscreen) panelsHidden = false;
      toast(next ? 'Fullscreen unavailable' : 'Could not exit fullscreen');
    } finally {
      fullscreenBusy = false;
    }
  }

  function toggleStageFullscreen() {
    void setStageFullscreen(!stageFullscreen);
  }

  // ── Copy / paste ────────────────────────────────────────────────
  // Module-local clipboard for selected user-placed elements. Scenery
  // and screens are owned by the venue / 2D designer respectively, so
  // they're intentionally NOT copied — those don't make sense to
  // duplicate (you can't have two stage backdrops). Clipboard is per
  // window: cross-window paste isn't a goal here.
  let elementClipboard: UserStageElement[] = [];

  function copySelection() {
    const sel = $selectedStage3DTargets;
    if (!sel.size) { toast('Nothing selected to copy'); return; }
    const elements = userElements;
    const copies: UserStageElement[] = [];
    for (const key of sel) {
      const s = parseSelection(key);
      if (s?.kind !== 'element') continue;
      const el = elements.find(e => e.id === s.id);
      if (el) copies.push(JSON.parse(JSON.stringify(el)));
    }
    if (!copies.length) { toast('Only library elements can be copied'); return; }
    elementClipboard = copies;
    toast(`Copied ${copies.length} element${copies.length === 1 ? '' : 's'}`);
  }

  function pasteSelection() {
    if (!elementClipboard.length) { toast('Clipboard empty'); return; }
    const newIds: string[] = [];
    for (const original of elementClipboard) {
      const clone: UserStageElement = {
        ...JSON.parse(JSON.stringify(original)),
        id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        // Offset so pasted copies don't sit on top of the originals.
        position: [original.position[0] + 3, original.position[1], original.position[2] + 3],
      };
      stage3dScene.addUserElement(clone);
      newIds.push(`element:${clone.id}`);
    }
    setStage3DMultiSelection(newIds);
    toast(`Pasted ${newIds.length} element${newIds.length === 1 ? '' : 's'}`);
  }

  // Window-level shortcuts for Cmd/Ctrl-Z undo, Shift-Cmd-Z (or Ctrl-Y)
  // redo, and H to toggle panels. Gizmo / duplicate / delete keys are
  // owned by Stage3DRenderer; we just handle the chrome here.
  function onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelection();
    } else if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteSelection();
    } else if (e.key.toLowerCase() === 'h' && !mod) {
      e.preventDefault();
      togglePanels();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    const onDomFullscreenChange = () => {
      if (!isDesktopApp || stageFullscreen || document.fullscreenElement) {
        syncStageFullscreen(!!document.fullscreenElement);
      }
    };
    document.addEventListener('fullscreenchange', onDomFullscreenChange);
    removeDomFullscreenListener = () => document.removeEventListener('fullscreenchange', onDomFullscreenChange);

    if (isDesktopApp) {
      invoke<{ ok?: boolean; fullScreen?: boolean }>('stage3d_get_fullscreen')
        .then((result) => {
          if (result?.ok) syncStageFullscreen(!!result.fullScreen);
        })
        .catch(() => {});
      const off = (window as any).electronAPI?.on?.('stage3d-fullscreen-changed', (payload: { fullScreen?: boolean }) => {
        syncStageFullscreen(!!payload?.fullScreen);
      });
      if (typeof off === 'function') removeStageFullscreenListener = off;
    }
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKeydown);
    removeDomFullscreenListener?.();
    removeDomFullscreenListener = null;
    removeStageFullscreenListener?.();
    removeStageFullscreenListener = null;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (nativeScenePublishTimer) {
      clearTimeout(nativeScenePublishTimer);
      nativeScenePublishTimer = null;
    }
    // Clear the core's 3D stage scene on close so it can never bleed
    // into the 2D editor or mapping output.
    if (isDesktopApp) {
      void setNativeRendererStage3DScene(null).catch(() => { /* core without stage3d */ });
    }
    recorderHandle?.stop();
    recorderHandle = null;
  });
</script>

<div data-help-page="stage-simulator" class="stage3d-root" class:external={!renderViewport}>
  {#if renderViewport}
    <div class="viewport-fallback">
      <p>Open Stage 3D in the pop-out window for the live view.</p>
    </div>
  {/if}

  {#if !panelsHidden}
  <header class="topbar">
    <button class="icon-btn" onclick={onClose} aria-label="Back to editor" title="Back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <span class="place-title">Stage Sim</span>
    <span class="tb-divider" aria-hidden="true"></span>
    <div class="seg" role="tablist">
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'translate'}
        onclick={() => setGizmoMode('translate')}
        title="Move (W / G)">Move</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'rotate'}
        onclick={() => setGizmoMode('rotate')}
        title="Rotate (E / R)">Rotate</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'scale'}
        onclick={() => setGizmoMode('scale')}
        title="Scale (S)">Scale</button>
    </div>

    <button class="tbtn" class:on={snapOn} aria-pressed={snapOn} onclick={toggleSnap} title="Snap to 1 m and 15°">Snap</button>

    <button class="tbtn" onclick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
    <button class="tbtn" onclick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>

    <div class="spacer"></div>

    <label class="dim-label" for="stage3d-venue-select">Venue</label>
    <select
      id="stage3d-venue-select"
      class="vsel"
      value={venue}
      onchange={(e) => setVenue((e.target as HTMLSelectElement).value as Stage3DVenue)}
    >
      <option value="empty">Blank room</option>
      <option value="festival">Festival mainstage</option>
      <option value="arena">Arena</option>
      <option value="club">Club</option>
      <option value="nightclub">Nightclub</option>
      <option value="sphere">Sphere (immersive dome)</option>
    </select>

    <label class="dim-label" for="stage3d-pa-select">PA</label>
    <select id="stage3d-pa-select" class="vsel" value="" onchange={onPASelect}>
      <option value="">Add PA preset…</option>
      <option value="linearray">Flown line array L/R</option>
      <option value="festivalpa">Festival PA + subs</option>
      <option value="groundstack">Ground-stacked L/R</option>
      <option value="club">Club point-source</option>
      <option value="nightclub">Nightclub distributed</option>
    </select>

    <span class="tb-divider" aria-hidden="true"></span>
    <button class="tbtn" onclick={() => $stage3DRendererControls?.topCamera()}>Top</button>
    <button class="tbtn" onclick={() => $stage3DRendererControls?.frameCamera()}>Frame</button>
    <button class="tbtn" onclick={() => { $stage3DRendererControls?.reload(); toast('Scene reloaded'); }} title="Rebuild venue + screens">Reload</button>
    <span class="tb-divider" aria-hidden="true"></span>
    {#if !isRecording}
      <select
        class="vsel rec-res"
        value={recRes}
        onchange={(e) => (recRes = (e.target as HTMLSelectElement).value as keyof typeof REC_RES)}
        title="Recording resolution — always 16:9, independent of output resolution"
      >
        <option value="1080">1080p</option>
        <option value="4k">4K</option>
      </select>
    {/if}
    <button
      class="tbtn rec-btn"
      class:recording={isRecording}
      onclick={toggleStageRecording}
      title={isRecording ? 'Stop stage recording' : `Record stage scene (${REC_RES[recRes].label}, 16:9)`}
    >
      {isRecording ? `■ ${formatRecordingDuration(recordingDuration)}` : '● Rec'}
    </button>
    <button
      class="tbtn"
      class:reel-on={reelOpen}
      aria-pressed={reelOpen}
      onclick={() => { reelOpen = !reelOpen; }}
      title="Demo Reel — shot-based sizzle-reel recorder"
    >Reel</button>
    <span class="tb-divider" aria-hidden="true"></span>
    <button class="tbtn" onclick={togglePanels} title="Hide panels (H)">Hide</button>
    <button class="tbtn" onclick={saveDesign}>Save</button>
    <button class="tbtn load-btn" onclick={loadDesign}>Load</button>
    <button class="tbtn danger" onclick={clearElements}>Clear</button>
    <input bind:this={fileInput} type="file" accept="application/json" style="display:none" onchange={onFileChosen} />
    <input bind:this={modelImportInput} type="file" accept=".glb,.gltf,.obj" style="display:none" onchange={onModelImportChosen} />
  </header>

  <!-- Camera HUD — its own strip under the toolbar so it
       never fights the (already packed) topbar for horizontal space. -->
  <div class="viewport-hud">
    <div class="hud-group fullscreen-ctl">
      <button
        class="hud-btn fullscreen-toggle"
        class:on={stageFullscreen}
        onclick={toggleStageFullscreen}
        disabled={fullscreenBusy}
        title={stageFullscreen ? 'Exit fullscreen stage view' : 'Fullscreen stage view on this display'}
      >
        {stageFullscreen ? 'Exit full screen' : 'Full screen'}
      </button>
    </div>
    <div class="hud-group" title="Camera elevation — ↑/↓ arrows in the viewport work too">
      <button class="hud-btn" onclick={() => $stage3DRendererControls?.nudgeElevation(1)} title="Camera up (↑)">▲</button>
      <button class="hud-btn" onclick={() => $stage3DRendererControls?.nudgeElevation(-1)} title="Camera down (↓)">▼</button>
    </div>
    <div class="hud-group fov-ctl" title="Field of view — go wide to swallow the whole Sphere. Shift+scroll in the viewport works too.">
      <span class="fov-label">FOV</span>
      <input type="range" min="15" max="120" step="1"
        value={$stage3DCameraFov}
        oninput={(e) => $stage3DRendererControls?.setFov(parseFloat((e.target as HTMLInputElement).value))} />
      <span class="fov-val">{Math.round($stage3DCameraFov)}°</span>
    </div>
  </div>
  {/if}

  {#if !panelsHidden}
  <aside class="lib">
    <h3>Element Library</h3>
    <div class="lib-actions">
      <button class="mini-action" onclick={blankSlate}>Blank room</button>
      <button class="mini-action" onclick={triggerModelImport}>Import model</button>
    </div>
    {#each libraryGroups as group}
      <div class="grp">
        <div class="ghd">{group.name}</div>
        {#each group.items as [type, def]}
          <button class="additem" onclick={() => addElement(type)}>
            <span class="ic">{def.icon}</span>{def.label}
          </button>
        {/each}
      </div>
    {/each}
    {#if screenLayers.length > 0}
      <div class="grp">
        <div class="ghd">
          Screens (auto)
          <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(screenLayers.map(l => `screen:${l.id}`))}
            title="Select all screens"
          >All</button>
        </div>
        {#each screenLayers as layer (layer.id)}
          {@const key = `screen:${layer.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey)
              ? toggleStage3DSelection(key)
              : setStage3DSelection(key)}
            title="Shift+click to add to selection"
          >
            <span class="ic">▦</span>{layer.name}
          </button>
        {/each}
      </div>
    {/if}
    {#if userElements.length > 0}
      <div class="grp">
        <div class="ghd">
          Placed elements
          <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(userElements.map(el => `element:${el.id}`))}
            title="Select all placed elements"
          >All</button>
        </div>
        {#each userElements as el (el.id)}
          {@const key = `element:${el.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey)
              ? toggleStage3DSelection(key)
              : setStage3DSelection(key)}
            title="Shift+click to add to selection"
          >
            <span class="ic">▤</span>{el.type}
          </button>
        {/each}
      </div>
    {/if}
    {#if sceneryItems.length > 0}
      <div class="grp">
        <div class="ghd">
          Venue elements
          <button
            class="ghd-action"
            onclick={() => stage3dScene.clearSceneryOverrides()}
            title="Restore all venue elements to default"
          >Reset</button>
        </div>
        {#each sceneryItems as item (item.id)}
          {@const key = `scenery:${item.id}`}
          {@const isDeleted = sceneryOverrides[item.id]?.deleted}
          <div class="scenery-row">
            <button
              class="additem screen scenery-pick"
              class:selected={$selectedStage3DTargets.has(key)}
              class:primary={$selectedStage3DNodeId === key}
              class:deleted={isDeleted}
              disabled={isDeleted}
              onclick={(e) => (e.shiftKey || e.metaKey)
                ? toggleStage3DSelection(key)
                : setStage3DSelection(key)}
              title={isDeleted ? 'Hidden — click ⟲ to restore' : 'Shift+click to add to selection'}
            >
              <span class="ic">◇</span>{item.label}
            </button>
            {#if isDeleted}
              <button class="scenery-act" onclick={() => restoreScenery(item.id)} title="Restore">⟲</button>
            {:else}
              <button class="scenery-act danger" onclick={() => deleteScenery(item.id)} title="Hide / delete">✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </aside>

  <aside class="props">
    <h3>Inspector</h3>
    {#if $selectedStage3DTargets.size > 1}
      <div class="multi-banner">
        <b>{$selectedStage3DTargets.size}</b> selected — gizmo moves all together.
        Inspector shows the primary{selectedScreen ? ' (cyan outline)' : selectedElement ? ' (cyan outline)' : ''}.
      </div>
    {/if}
    {#if venue === 'sphere' && !selectedElement && !selectedScenery}
      <div class="inspector-tabs" role="tablist" aria-label="Sphere inspector">
        <button
          class="inspector-tab"
          class:active={sphereInspectorTab === 'screen'}
          disabled={!sphereScreenLayer}
          onclick={showSphereScreenInspector}
          role="tab"
          aria-selected={sphereInspectorTab === 'screen'}
        >Screen</button>
        <button
          class="inspector-tab"
          class:active={sphereInspectorTab === 'room'}
          onclick={showSphereRoomInspector}
          role="tab"
          aria-selected={sphereInspectorTab === 'room'}
        >Room</button>
      </div>
      {#if sphereInspectorTab === 'screen' && sphereScreenLayer}
        <StageNodeProperties layerId={sphereScreenLayer.id} />
      {:else}
        <StageLightingPanel />
      {/if}
    {:else if selectedScreen}
      <StageNodeProperties layerId={selectedScreen.id} />
    {:else if selectedElement}
      <StageElementProperties elementId={selectedElement.id} />
    {:else if selectedScenery}
      <div class="scenery-inspect">
        <div class="scenery-title">{selectedScenery.label}</div>
        <div class="scenery-sub">Venue element</div>
        <p class="scenery-note">
          Drag the gizmo to move, rotate, or scale this piece — changes
          persist with the project. Use <span class="kbd">W</span>
          <span class="kbd">E</span> <span class="kbd">S</span> to switch
          tools.
        </p>
        <button class="scenery-del" onclick={() => deleteScenery(selectedScenery.id)}>
          Hide this element
        </button>
        <button class="scenery-restore" onclick={() => restoreScenery(selectedScenery.id)}>
          Reset to default position
        </button>
      </div>
    {:else}
      <StageLightingPanel />
      <div class="empty">
        Click an element in the scene to edit it, or add one from the library.
        Shift+click any item (or in the library list) to add it to a multi-selection.
        LED screens are synced from the 2D Stage Designer — they appear on the venue's back wall (or wrap the dome interior on the Sphere venue).
      </div>
    {/if}
  </aside>

  <div class="hud">
    <span><b>{userElements.length}</b> element{userElements.length === 1 ? '' : 's'}</span>
    <span><b>{screenLayers.length}</b> screen{screenLayers.length === 1 ? '' : 's'}</span>
    {#if $selectedStage3DTargets.size > 1}
      <span class="multi-pill"><b>{$selectedStage3DTargets.size}</b> selected</span>
    {/if}
    <span><span class="kbd">⇧</span>+click multi</span>
    <span><span class="kbd">W</span><span class="kbd">E</span><span class="kbd">S</span> tools</span>
    <span><span class="kbd">⌘C</span>/<span class="kbd">⌘V</span> copy</span>
    <span><span class="kbd">⌘Z</span> undo</span>
    <span><span class="kbd">D</span> dup</span>
    <span><span class="kbd">⌫</span> del</span>
    <span><span class="kbd">H</span> hide</span>
  </div>
  {/if}

  {#if panelsHidden}
    {#if stageFullscreen}
      <button class="show-panels-btn fullscreen-exit-btn" onclick={toggleStageFullscreen} title="Exit fullscreen stage view">Exit full screen</button>
    {:else}
      <button class="show-panels-btn" onclick={togglePanels} title="Show panels (H)">Show panels</button>
    {/if}
  {/if}

  {#if reelOpen}
    <div class="reel-host">
      <DemoReelPanel onClose={() => { reelOpen = false; }} />
    </div>
  {/if}

  {#if toastMessage}
    <div class="toast">{toastMessage}</div>
  {/if}
</div>

<style>
  .stage3d-root {
    position: fixed;
    inset: 0;
    background: var(--ga-void, #0a0908);
    z-index: 1000;
    overflow: hidden;
    color: var(--ga-ink-0);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: var(--ga-text-control, 12px);
  }
  .stage3d-root.external { background: transparent; pointer-events: none; }
  .stage3d-root.external :global(button),
  .stage3d-root.external :global(input),
  .stage3d-root.external :global(select),
  .stage3d-root.external .topbar,
  .stage3d-root.external .lib,
  .stage3d-root.external .props,
  .stage3d-root.external .hud,
  .stage3d-root.external .reel-host,
  .stage3d-root.external .toast { pointer-events: auto; }
  .reel-host { position: absolute; inset: 0; pointer-events: none; z-index: 25; }
  .reel-host :global(.reel-panel) { pointer-events: auto; }
  .viewport-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ga-ink-2);
    font-size: var(--ga-text-title, 14px);
  }

  /* ── Top bar: the same bar as the app top bar ───────────────────── */
  .topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--ga-bar-h, 48px);
    box-sizing: border-box;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--ga-bar-gap, 6px);
    padding: 0 14px;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--ga-line-2);
  }
  .place-title {
    margin-left: 4px;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-title, 14px);
    font-weight: var(--ga-weight-title, 650);
    white-space: nowrap;
  }
  .tb-divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--ga-line-2);
    flex-shrink: 0;
  }
  .icon-btn {
    width: var(--ga-bar-control-h, 30px);
    height: var(--ga-bar-control-h, 30px);
    flex-shrink: 0;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid var(--ga-line-2);
    background: var(--ga-card);
    color: var(--ga-ink-0);
    cursor: pointer;
  }
  .icon-btn:hover { border-color: var(--ga-line-3); }
  .seg {
    display: flex;
    gap: 2px;
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 2px;
  }
  .seg-btn {
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1);
    background: none;
    border: none;
    padding: 0 10px;
    border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    cursor: pointer;
  }
  .seg-btn:hover { color: var(--ga-ink-0); }
  .seg-btn.on {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    box-shadow: inset 0 0 0 1px var(--ga-selection-line);
  }
  .tbtn {
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tbtn:hover { border-color: var(--ga-line-3); color: var(--ga-ink-0); }
  .tbtn:disabled { opacity: 0.35; cursor: not-allowed; }
  .tbtn:disabled:hover { border-color: var(--ga-line-2); color: var(--ga-ink-1); }
  .tbtn.danger:hover { border-color: var(--ga-rec, #ff3b30); color: var(--ga-rec, #ff3b30); }
  /* Toggles: the selection colours, above the theme's button skin. */
  .tbtn.on,
  .tbtn.reel-on {
    background: var(--ga-selection-bg) !important;
    border-color: var(--ga-selection-line) !important;
    color: var(--ga-selection-ink) !important;
  }

  /* ── Camera HUD strip (under the topbar, clear of the inspector) ── */
  .viewport-hud {
    position: absolute;
    top: calc(var(--ga-bar-h, 48px) + 24px);
    right: 322px;
    z-index: 19;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hud-group {
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 88%, transparent);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    backdrop-filter: blur(8px);
  }
  .hud-btn {
    height: 100%;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1);
    background: transparent;
    border: none;
    border-right: 1px solid var(--ga-line-1);
    padding: 0 9px;
    cursor: pointer;
  }
  .hud-btn:last-child { border-right: none; }
  .hud-btn:hover { color: var(--ga-ink-0); }
  .hud-btn:disabled {
    opacity: 0.45;
    cursor: wait;
  }
  .fullscreen-ctl { overflow: hidden; }
  .fullscreen-toggle {
    min-width: 88px;
    border-right: none;
  }
  .fullscreen-toggle.on {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
  }
  .fov-ctl {
    gap: 6px;
    padding: 0 10px;
  }
  .fov-ctl .fov-label {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2);
  }
  .fov-ctl input[type='range'] {
    width: 84px;
    accent-color: var(--ga-selection-line);
  }
  .fov-ctl .fov-val {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-0);
    font-variant-numeric: tabular-nums;
    min-width: 30px;
    text-align: right;
  }
  .rec-res {
    width: auto;
    padding: 0 6px;
  }
  .rec-btn {
    min-width: 66px;
    text-align: center;
  }
  .rec-btn.recording {
    background: color-mix(in srgb, var(--ga-rec, #ff3b30) 18%, transparent) !important;
    border-color: color-mix(in srgb, var(--ga-rec, #ff3b30) 72%, transparent) !important;
    color: var(--ga-rec, #ff3b30) !important;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }
  .rec-btn.recording:hover {
    border-color: var(--ga-rec, #ff3b30) !important;
  }
  .show-panels-btn {
    position: absolute;
    top: 9px; left: 50%;
    transform: translateX(-50%);
    z-index: 15;
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-0);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-3);
    border-radius: var(--ga-r-soft, 8px);
    padding: 0 16px;
    cursor: pointer;
    pointer-events: auto;
    backdrop-filter: blur(10px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }
  .show-panels-btn.fullscreen-exit-btn {
    left: auto;
    right: 14px;
    transform: none;
    opacity: 0.42;
  }
  .show-panels-btn.fullscreen-exit-btn:hover {
    opacity: 1;
  }
  .spacer { flex: 1 1 0; min-width: 0; }
  .dim-label {
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-2);
  }
  .vsel {
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    min-width: 0;
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    color: var(--ga-ink-0);
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 8px;
    cursor: pointer;
  }
  #stage3d-venue-select { width: clamp(150px, 11vw, 205px); }
  #stage3d-pa-select { width: clamp(140px, 10vw, 190px); }
  @media (max-width: 1900px) {
    .dim-label { display: none; }
  }
  @media (max-width: 1740px) {
    .tbtn.danger { display: none; }
    #stage3d-pa-select { width: 160px; }
    #stage3d-venue-select { width: 170px; }
  }
  @media (max-width: 1620px) {
    .place-title,
    .place-title + .tb-divider { display: none; }
    .tbtn, .seg-btn { padding-inline: 8px; }
    #stage3d-pa-select { width: 140px; }
    #stage3d-venue-select { width: 150px; }
  }
  @media (max-width: 1500px) {
    .tbtn.load-btn { display: none; }
  }

  /* ── Library ────────────────────────────────────────────────── */
  .lib {
    position: absolute;
    top: calc(var(--ga-bar-h, 48px) + 12px); left: 12px; bottom: 12px;
    width: 212px;
    box-sizing: border-box;
    z-index: 15;
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 90%, transparent);
    backdrop-filter: blur(14px);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft, 8px);
    padding: 12px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
  }
  /* Eyebrows (docs/DESIGN-SYSTEM.md). */
  .lib h3,
  .props h3,
  .ghd {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2);
    text-transform: uppercase;
    line-height: 1.2;
  }
  .lib h3,
  .props h3 {
    margin: 0 0 8px;
  }
  .lib-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 16px;
  }
  .mini-action {
    height: var(--ga-control-h, 26px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-0);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 6px;
    white-space: nowrap;
    cursor: pointer;
  }
  .mini-action:hover {
    border-color: var(--ga-line-3);
  }
  .grp { margin-bottom: 16px; }
  .ghd {
    margin-bottom: 6px;
    display: flex; align-items: center; gap: 6px;
    min-height: 20px;
  }
  .additem {
    width: 100%; text-align: left;
    min-height: var(--ga-control-h, 26px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-0);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 4px 8px; margin-bottom: 4px;
    cursor: pointer; transition: .14s;
    display: flex; align-items: center; gap: 8px;
  }
  .additem:hover {
    border-color: var(--ga-line-3);
  }
  .additem.screen.selected,
  .additem.screen.selected:hover {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
    color: var(--ga-selection-ink);
  }
  .additem.screen.selected.primary,
  .additem.screen.selected.primary:hover {
    box-shadow: inset 3px 0 0 var(--ga-selection-line) !important;
  }
  .additem .ic { width: 16px; text-align: center; opacity: 0.7; }

  /* ── Venue element rows (scenery) ─────────────────────────────── */
  .scenery-row {
    display: flex; align-items: center; gap: 4px; margin-bottom: 4px;
  }
  .scenery-row .scenery-pick { margin-bottom: 0; flex: 1; min-width: 0; }
  .scenery-pick :global(span) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .scenery-pick.deleted {
    opacity: 0.4;
    text-decoration: line-through;
    cursor: default;
  }
  .scenery-pick.deleted:hover { border-color: var(--ga-line-2); }
  .scenery-act {
    flex: 0 0 auto;
    width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px);
    font: inherit; font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-2);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    cursor: pointer;
  }
  .scenery-act:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .scenery-act.danger:hover { color: var(--ga-rec, #ff3b30); border-color: var(--ga-rec, #ff3b30); }

  /* ── Venue element inspector ──────────────────────────────────── */
  .scenery-inspect { display: flex; flex-direction: column; gap: 8px; }
  .scenery-title { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); color: var(--ga-ink-0); }
  .scenery-sub {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2);
  }
  .scenery-note { color: var(--ga-ink-2); font-size: var(--ga-text-meta, 11px); line-height: 1.5; margin: 0 0 4px; }
  .scenery-del, .scenery-restore {
    min-height: var(--ga-control-h, 26px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    text-align: left;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px); padding: 4px 10px; cursor: pointer; color: var(--ga-ink-0);
  }
  .scenery-del:hover { border-color: var(--ga-rec, #ff3b30); color: var(--ga-rec, #ff3b30); }
  .scenery-restore:hover { border-color: var(--ga-line-3); }

  .ghd-action {
    margin-left: auto;
    height: 20px;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-1);
    background: transparent;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 6px;
    cursor: pointer;
  }
  .ghd-action:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }

  /* ── Properties ─────────────────────────────────────────────── */
  .props {
    position: absolute;
    top: calc(var(--ga-bar-h, 48px) + 12px); right: 12px; bottom: 12px;
    width: 264px;
    box-sizing: border-box;
    z-index: 15;
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 90%, transparent);
    backdrop-filter: blur(14px);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft, 8px);
    padding: 12px;
    overflow-y: auto;
  }
  .empty {
    color: var(--ga-ink-2);
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.5;
    margin-top: 8px;
  }
  .multi-banner {
    background: var(--ga-selection-bg);
    border: 1px solid var(--ga-selection-line);
    border-radius: var(--ga-r-hard, 5px);
    padding: 8px 10px;
    margin-bottom: 12px;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.5;
    color: var(--ga-selection-ink);
  }
  .multi-banner b { color: var(--ga-ink-0); }
  .inspector-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    margin: 0 0 12px;
    padding: 2px;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
  }
  .inspector-tab {
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1);
    background: transparent;
    border: 0;
    border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    padding: 0 8px;
    cursor: pointer;
  }
  .inspector-tab:hover:not(:disabled) {
    color: var(--ga-ink-0);
  }
  .inspector-tab.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    box-shadow: inset 0 0 0 1px var(--ga-selection-line);
  }
  .inspector-tab:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── HUD ────────────────────────────────────────────────────── */
  .hud {
    position: absolute;
    bottom: 18px; left: 50%;
    transform: translateX(-50%);
    z-index: 14;
    display: flex; gap: 14px; align-items: center;
    font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2);
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 90%, transparent);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft, 8px);
    padding: 6px 14px;
    white-space: nowrap;
    backdrop-filter: blur(10px);
  }
  .hud b { color: var(--ga-ink-0); font-weight: 600; }
  .kbd {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    padding: 1px 5px;
    color: var(--ga-ink-1);
    font-size: var(--ga-text-meta, 11px);
    margin: 0 2px;
  }
  .multi-pill {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    border: 1px solid var(--ga-selection-line);
    border-radius: var(--ga-r-hard, 5px);
    padding: 1px 8px;
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  .toast {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-3);
    color: var(--ga-ink-0);
    font-size: var(--ga-text-body, 13px);
    padding: 8px 16px;
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  @media (max-width: 880px) {
    .lib, .props, .hud { display: none; }
  }
</style>
