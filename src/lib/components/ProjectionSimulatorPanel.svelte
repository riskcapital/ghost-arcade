<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { blue } from '../theming/blueScale';
  import { get } from 'svelte/store';
  import { settings, type OutputSlice } from '../stores/settings';
  import { workspace } from '../stores/workspace';
  import { invoke, isDesktopApp } from '../bridge';
  import { createAssetRefFromFile, resolveAssetRefForRuntime } from '../storage/assetRegistry';
  import { startRecording as startCanvasRecording, formatRecordingDuration, type RecorderHandle } from '../recording/recorder';
  import {
    startNativeLiveFrameRecording,
    startNativeRendererLiveFrameRecording,
  } from '../recording/nativeLiveFrameRecorder';
  import { getNativeRendererCapabilities, setNativeRendererProjectionSimScene } from '../api/native-renderer';
  import { ProjectionSimulatorRenderer, type ProjectionSimModelPick } from '../projectionSim/ProjectionSimulatorRenderer';
  import {
    canSolve,
    defaultCalibration,
    matchedPoints,
    MIN_CALIBRATION_POINTS,
    newCalibrationPointId,
    predictImagePoint,
    solveCalibration,
  } from '../projectionSim/calibration/calibrationSession';
  import { fovFromThrowRatio, projectorThrowRatio } from '../projectionSim/projectorLens';
  import {
    isProjectionSimTargetLocked,
    projectionSimGizmoMode,
    projectionSimHistoryVersion,
    projectionSimScene,
    selectedProjectionSimTargets,
    selectedProjectionSimTarget,
    setProjectionSimSelection,
    toggleProjectionSimSelection,
  } from '../projectionSim/store';
  import {
    createProjectionSimScene,
    makeProjectionSimProjector,
    type ProjectionSimCalibration,
    type ProjectionSimObject,
    type ProjectionSimPrimitiveKind,
    type ProjectionSimProjector,
    type ProjectionSimScene,
    type ProjectionSimSelection,
    type ProjectionSimVec3,
  } from '../projectionSim/types';
  import { PROJECTION_SIM_PRESETS, buildProjectionSimPreset } from '../projectionSim/presets';
  import {
    snapProjectionSimObjectTransform,
    spaceProjectionSimObjectsEvenly,
    type ProjectionSimAxis,
    type ProjectionSimSnapGuide,
  } from '../projectionSim/snapping';

  export let sourceCanvas: HTMLCanvasElement | null = null;
  export let onClose: (() => void) | null = null;
  export let nativeWindowMode = false;

  let canvas: HTMLCanvasElement;
  let rootEl: HTMLDivElement;
  let renderer: ProjectionSimulatorRenderer | null = null;
  let raf = 0;
  let fileInput: HTMLInputElement;
  let designFileInput: HTMLInputElement;
  let recorderHandle: RecorderHandle | null = null;
  let recordingDuration = 0;
  let isRecording = false;
  let recordingUsesNative = false;
  let panelsHidden = false;
  let nativeFullScreen = false;
  let removeNativeFullscreenListener: (() => void) | null = null;
  let selectedPresetId = PROJECTION_SIM_PRESETS[0]?.id ?? '';
  let loadedPresetId = selectedPresetId;
  let editProjectors = false;
  let snapEnabled = true;
  let snapTouch = true;
  let snapEqualSpacing = true;
  let snapThreshold = 0.12;
  let snapGuides: ProjectionSimSnapGuide[] = [];
  let snapGuideTimer: number | null = null;
  let sceneClipboard: { kind: 'object'; object: ProjectionSimObject } | { kind: 'projector'; projector: ProjectionSimProjector } | null = null;
  let canUndoScene = false;
  let canRedoScene = false;
  let nativeScenePublishTimer: ReturnType<typeof setTimeout> | null = null;
  let nativeScenePublishWarnings = 0;

  // ── Point-matching calibration ────────────────────────────────────
  // The operator clicks a feature on the model, then drags the crosshair
  // on the pad (shown live on the real projector) onto the same physical
  // feature. Six or more matches solve the projector's pose and lens.
  type CalibrationOutputMode = 'black' | 'content' | 'model';
  let calibratingId: string | null = null;
  let calibrationPointId: string | null = null;
  let calibrationCursor: [number, number] | null = null;
  let calibrationSnap = true;
  let calibrationOutputMode: CalibrationOutputMode = 'black';
  let padCanvas: HTMLCanvasElement | null = null;
  let padPreview: ImageData | null = null;
  let padPreviewAt = 0;
  let padDrag: { pointerId: number; x: number; y: number; fine: boolean } | null = null;
  let overlayInFlight = false;
  let overlayQueued = false;
  let overlaySentFor: string | null = null;
  let dockHeight = 0;

  const primitiveKinds: ProjectionSimPrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'column', 'plane'];
  const BLANK_PRESET_ID = '__blank__';

  $: selectedTarget = $selectedProjectionSimTarget;
  $: selectedTargets = $selectedProjectionSimTargets;
  $: selectedTargetList = [...selectedTargets];
  $: multiSelectionCount = selectedTargetList.length;
  $: selectedObject = findSelectedObject($projectionSimScene, selectedTarget);
  $: selectedProjector = findSelectedProjector($projectionSimScene, selectedTarget);
  $: selectedLocked = multiSelectionCount > 1
    ? selectedTargetList.every((target) => isProjectionSimTargetLocked($projectionSimScene, target))
    : isProjectionSimTargetLocked($projectionSimScene, selectedTarget);
  $: calibratingProjector = calibratingId
    ? $projectionSimScene.projectors.find((projector) => projector.id === calibratingId) ?? null
    : null;
  $: if (calibratingId && !calibratingProjector) stopCalibration();
  $: calibration = calibratingProjector
    ? (calibratingProjector.calibration ?? defaultCalibration(calibratingProjector))
    : null;
  $: calibrationPoint = calibration && calibrationPointId
    ? calibration.points.find((point) => point.id === calibrationPointId) ?? null
    : null;
  $: calibrationMatched = calibration ? matchedPoints(calibration).length : 0;
  $: calibrationScreens = calibratingId
    ? $settings.output.slices.filter((slice) => slice.mapSimProjectorId === calibratingId)
    : [];
  $: calibrationStep = !calibration
    ? ''
    : calibrationPoint
      ? `Drag the crosshair onto point ${calibration.points.indexOf(calibrationPoint) + 1} on the real object, then press Enter.`
      : calibrationMatched < MIN_CALIBRATION_POINTS
        ? `Click a feature on the model (${calibrationMatched} of ${MIN_CALIBRATION_POINTS} matched).`
        : 'Click another feature to add a point, or pick a point to adjust it.';
  $: renderer?.setSnapToVertices(calibrationSnap);
  // Keep the model centred above the calibration dock.
  $: renderer?.setViewInsetBottom(calibratingProjector && !panelsHidden ? dockHeight + 18 : 0);
  $: renderer?.setCalibrationMarkers(calibration
    ? calibration.points.map((point, index) => ({
        id: point.id,
        label: String(index + 1),
        world: point.world,
        matched: !!point.image,
        selected: point.id === calibrationPointId,
      }))
    : []);
  $: {
    calibratingId;
    calibrationCursor;
    calibration;
    calibrationPointId;
    calibrationOutputMode;
    queueOverlay();
  }
  $: {
    calibration;
    calibrationCursor;
    calibrationPointId;
    calibratingProjector;
    drawPad();
  }
  $: selectedPreset = PROJECTION_SIM_PRESETS.find((preset) => preset.id === selectedPresetId) ?? PROJECTION_SIM_PRESETS[0];
  $: canCopySceneItem = Boolean(selectedObject || selectedProjector);
  $: canPasteSceneItem = Boolean(sceneClipboard);
  $: {
    $projectionSimHistoryVersion;
    const historyCounts = projectionSimScene.getHistoryCounts();
    canUndoScene = historyCounts.past > 0;
    canRedoScene = historyCounts.future > 0;
  }
  // Deliberately NOT pushed to the core while the panel is merely open.
  // `scene_overlay_items()` in the core composites any set projection-sim
  // scene into the MAIN output, so a live push painted a translucent ghost
  // of the sim geometry over the editor preview (and, via the composite
  // mirror, back into the sim itself). The core only needs the scene while
  // native recording is capturing frames — `prepareFrame` pushes it fresh
  // each frame during recording, and `restore`/destroy clear it.

  function cloneSceneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function buildReferenceScene(id: string): ProjectionSimScene | null {
    if (id === BLANK_PRESET_ID) return createProjectionSimScene();
    if (!id) return null;
    return buildProjectionSimPreset(id);
  }

  function getSceneAdditions(scene: ProjectionSimScene, referenceId: string): {
    objects: ProjectionSimObject[];
    projectors: ProjectionSimProjector[];
  } {
    const reference = buildReferenceScene(referenceId);
    if (!reference) {
      return {
        objects: scene.objects.map((object) => cloneSceneValue(object)),
        projectors: scene.projectors.map((projector) => cloneSceneValue(projector)),
      };
    }

    const referenceObjectNames = new Set(reference.objects.map((object) => object.name));
    const referenceProjectorNames = new Set(reference.projectors.map((projector) => projector.name));
    return {
      objects: scene.objects
        .filter((object) => !referenceObjectNames.has(object.name))
        .map((object) => cloneSceneValue(object)),
      projectors: scene.projectors
        .filter((projector) => !referenceProjectorNames.has(projector.name))
        .map((projector) => cloneSceneValue(projector)),
    };
  }

  function makeSceneId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function copyName(name: string): string {
    return /\bcopy\b/i.test(name) ? name : `${name} Copy`;
  }

  function close() {
    if (onClose) {
      onClose();
      return;
    }
    workspace.closeAll();
  }

  function findSelectedObject(scene: ProjectionSimScene, target: ProjectionSimSelection): ProjectionSimObject | null {
    if (!target?.startsWith('object:')) return null;
    const id = target.slice('object:'.length);
    return scene.objects.find((obj) => obj.id === id) ?? null;
  }

  function findSelectedProjector(scene: ProjectionSimScene, target: ProjectionSimSelection): ProjectionSimProjector | null {
    if (!target?.startsWith('projector:')) return null;
    const id = target.slice('projector:'.length);
    return scene.projectors.find((projector) => projector.id === id) ?? null;
  }

  function select(target: ProjectionSimSelection, additive = false) {
    if (target && additive) {
      toggleProjectionSimSelection(target);
    } else {
      setProjectionSimSelection(target);
    }
    renderer?.setSelection(get(selectedProjectionSimTarget));
    renderer?.setSelections([...get(selectedProjectionSimTargets)]);
  }

  function asSelectionTarget(target: string): NonNullable<ProjectionSimSelection> {
    return target as NonNullable<ProjectionSimSelection>;
  }

  function isSelectedTarget(target: string): boolean {
    return selectedTargets.has(asSelectionTarget(target));
  }

  function selectFromEvent(event: MouseEvent, target: string) {
    select(asSelectionTarget(target), event.shiftKey || event.metaKey || event.ctrlKey);
  }

  function setGizmo(mode: typeof $projectionSimGizmoMode) {
    projectionSimGizmoMode.set(mode);
    renderer?.setGizmoMode(mode);
  }

  function addPrimitive(kind: ProjectionSimPrimitiveKind) {
    projectionSimScene.addPrimitive(kind);
  }

  function addProjector() {
    projectionSimScene.addProjector();
  }

  function showSnapGuides(guides: ProjectionSimSnapGuide[]) {
    snapGuides = guides;
    if (snapGuideTimer !== null) window.clearTimeout(snapGuideTimer);
    if (!guides.length) {
      snapGuideTimer = null;
      return;
    }
    snapGuideTimer = window.setTimeout(() => {
      snapGuides = [];
      snapGuideTimer = null;
    }, 1200);
  }

  function handleTransform(target: ProjectionSimSelection, patch: Partial<ProjectionSimObject> & { target?: ProjectionSimVec3 }) {
    const scene = get(projectionSimScene);
    if (isProjectionSimTargetLocked(scene, target)) {
      showSnapGuides([]);
      return;
    }

    if (target?.startsWith('object:') && patch.position && $projectionSimGizmoMode === 'translate') {
      const object = scene.objects.find((item) => `object:${item.id}` === target);
      if (object) {
        const snapped = snapProjectionSimObjectTransform(scene, object, patch, {
          enabled: snapEnabled,
          touch: snapTouch,
          equalSpacing: snapEqualSpacing,
          threshold: snapThreshold,
        });
        showSnapGuides(snapped.guides);
        projectionSimScene.updateTargetTransform(target, snapped.patch);
        return;
      }
    }

    showSnapGuides([]);
    projectionSimScene.updateTargetTransform(target, patch);
  }

  function spaceEvenly(axis: ProjectionSimAxis) {
    const scene = get(projectionSimScene);
    projectionSimScene.setObjects(spaceProjectionSimObjectsEvenly(scene.objects, axis));
    showSnapGuides([{ axis, kind: 'spacing', label: `${axis.toUpperCase()} spaced evenly`, delta: 0 }]);
  }

  function deleteSelected() {
    const scene = get(projectionSimScene);
    const targets = [...get(selectedProjectionSimTargets)];
    if (!targets.length) return;
    for (const target of targets) {
      if (isProjectionSimTargetLocked(scene, target)) continue;
      const [kind, id] = target.split(':') as ['object' | 'projector', string];
      if (kind === 'object') projectionSimScene.removeObject(id);
      else projectionSimScene.removeProjector(id);
    }
  }

  function copySelectedSceneItem() {
    if (selectedObject) {
      sceneClipboard = { kind: 'object', object: cloneSceneValue(selectedObject) };
      return;
    }
    if (selectedProjector) {
      sceneClipboard = { kind: 'projector', projector: cloneSceneValue(selectedProjector) };
    }
  }

  function pasteSceneItem() {
    if (!sceneClipboard) return;
    if (sceneClipboard.kind === 'object') {
      const source = sceneClipboard.object;
      const pasted: ProjectionSimObject = {
        ...cloneSceneValue(source),
        id: makeSceneId('psobj'),
        name: copyName(source.name),
        position: [source.position[0] + 0.75, source.position[1], source.position[2] + 0.75],
        locked: false,
      };
      projectionSimScene.addImportedObject(pasted);
      sceneClipboard = { kind: 'object', object: cloneSceneValue(pasted) };
      return;
    }

    const source = sceneClipboard.projector;
    const pasted: ProjectionSimProjector = {
      ...cloneSceneValue(source),
      id: makeSceneId('psproj'),
      name: copyName(source.name),
      position: [source.position[0] + 0.75, source.position[1], source.position[2] + 0.75],
      target: [source.target[0] + 0.75, source.target[1], source.target[2] + 0.75],
      locked: false,
    };
    projectionSimScene.addProjectorFrom(pasted);
    sceneClipboard = { kind: 'projector', projector: cloneSceneValue(pasted) };
  }

  function undoScene() {
    projectionSimScene.undo();
    renderer?.setSelection(get(selectedProjectionSimTarget));
    renderer?.setSelections([...get(selectedProjectionSimTargets)]);
  }

  function redoScene() {
    projectionSimScene.redo();
    renderer?.setSelection(get(selectedProjectionSimTarget));
    renderer?.setSelections([...get(selectedProjectionSimTargets)]);
  }

  function toggleObjectLock(event: MouseEvent, id: string) {
    event.stopPropagation();
    projectionSimScene.toggleObjectLock(id);
  }

  function toggleProjectorLock(event: MouseEvent, id: string) {
    event.stopPropagation();
    projectionSimScene.toggleProjectorLock(id);
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (calibratingId && !(event.metaKey || event.ctrlKey)) {
      const step = event.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      if (arrows[event.key] && calibrationPointId) {
        event.preventDefault();
        nudgeCalibrationCursor(...arrows[event.key]);
        return;
      }
      if (event.key === 'Enter' && calibrationPointId) {
        event.preventDefault();
        setCalibrationPointImage();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (calibrationPointId) {
          calibrationPointId = null;
          calibrationCursor = null;
        } else {
          stopCalibration();
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && calibrationPointId) {
        event.preventDefault();
        removeCalibrationPoint(calibrationPointId);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoScene();
      else undoScene();
    } else if ((event.metaKey || event.ctrlKey) && key === 'y') {
      event.preventDefault();
      redoScene();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if ((event.metaKey || event.ctrlKey) && key === 'c') {
      event.preventDefault();
      copySelectedSceneItem();
    } else if ((event.metaKey || event.ctrlKey) && key === 'v') {
      event.preventDefault();
      pasteSceneItem();
    } else if (event.key === 'Escape') {
      setProjectionSimSelection(null);
    }
  }

  function applyPreset(id: string) {
    const preset = buildProjectionSimPreset(id);
    if (!preset) return;

    const additions = getSceneAdditions(get(projectionSimScene), loadedPresetId);
    const hasAdditions = additions.objects.length > 0 || additions.projectors.length > 0;
    const keepAdditions = hasAdditions
      ? confirm(`Keep your added objects/projectors when loading ${preset.name}?\n\nOK = Keep additions\nCancel = Clear for a clean preset`)
      : false;

    const next = keepAdditions
      ? {
          ...preset,
          objects: [...preset.objects, ...additions.objects],
          projectors: [...preset.projectors, ...additions.projectors],
        }
      : preset;

    projectionSimScene.loadScene(next);
    selectedPresetId = id;
    loadedPresetId = id;
  }

  function handlePresetSelect(event: Event) {
    selectedPresetId = (event.currentTarget as HTMLSelectElement).value;
  }

  function newBlankScene() {
    const count = $projectionSimScene.objects.length + $projectionSimScene.projectors.length;
    if (count > 0 && !confirm('Start a blank projection simulator scene?')) return;
    projectionSimScene.newScene();
    loadedPresetId = BLANK_PRESET_ID;
  }

  function syncProjectorsFromSlices() {
    const slices = get(settings).output.slices.filter((slice) => slice.enabled !== false);
    if (!slices.length) {
      alert('No output slices configured yet. Add slices in the Screens tab, then sync projectors here.');
      return;
    }
    const center = (slices.length - 1) / 2;
    const projectors = slices.map((slice, index) => {
      const p = makeProjectionSimProjector(slice.name || `Slice ${index + 1}`, [(index - center) * 5, 4.7, 9], [(index - center) * 2.4, 2.3, 0]);
      p.source = 'slice';
      p.sliceId = slice.id;
      p.crop = [slice.cropX, slice.cropY, slice.cropW, slice.cropH];
      p.edgeBlend = [slice.edgeBlendLeft ?? 0, slice.edgeBlendRight ?? 0, slice.edgeBlendTop ?? 0, slice.edgeBlendBottom ?? 0];
      p.color = index % 3 === 0 ? '#ffffff' : index % 3 === 1 ? '#d7edff' : '#fff2d8';
      return p;
    });
    projectionSimScene.setProjectors(projectors);
  }

  function triggerImport() {
    fileInput?.click();
  }

  function handleImportFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['glb', 'gltf', 'obj', 'fbx', 'ply'].includes(ext)) {
      alert('Supported imports: GLB, GLTF, OBJ, FBX, PLY point clouds');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
    const resolvedRuntimeUrl = resolveAssetRefForRuntime(assetRef, undefined, runtimeUrl) ?? runtimeUrl;
    const object: ProjectionSimObject = {
      id: `psobj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      type: ext === 'ply' ? 'pointcloud' : 'model',
      position: [0, 2, 0],
      rotation: [0, 0, 0],
      scale: [4, 4, 4],
      color: '#cdd6df',
      roughness: 0.84,
      visible: true,
      locked: false,
      castShadow: ext !== 'ply',
      receiveProjection: true,
      assetUrl: resolvedRuntimeUrl,
      assetRef,
      assetName: file.name,
      assetFormat: ext as ProjectionSimObject['assetFormat'],
      pointSize: 0.035,
    };
    projectionSimScene.addImportedObject(object);
    (event.target as HTMLInputElement).value = '';
  }

  function updateObject(id: string, patch: Partial<ProjectionSimObject>) {
    projectionSimScene.updateObject(id, patch);
  }

  function updateProjector(id: string, patch: Partial<ProjectionSimProjector>) {
    projectionSimScene.updateProjector(id, patch);
  }

  function updateObjectVec(id: string, key: 'position' | 'rotation' | 'scale', index: number, value: string) {
    const obj = selectedObject;
    if (!obj || obj.id !== id) return;
    const next = [...obj[key]] as ProjectionSimVec3;
    next[index] = parseFloat(value) || 0;
    updateObject(id, { [key]: next } as Partial<ProjectionSimObject>);
  }

  function updateProjectorVec(id: string, key: 'position' | 'target', index: number, value: string) {
    const projector = selectedProjector;
    if (!projector || projector.id !== id) return;
    const next = [...projector[key]] as ProjectionSimVec3;
    next[index] = parseFloat(value) || 0;
    updateProjector(id, { [key]: next } as Partial<ProjectionSimProjector>);
  }

  function updateProjectorCrop(id: string, index: number, value: string) {
    const projector = selectedProjector;
    if (!projector || projector.id !== id) return;
    const next = [...projector.crop] as [number, number, number, number];
    next[index] = Math.max(0, Math.min(1, parseFloat(value) || 0));
    updateProjector(id, { crop: next });
  }

  function updateProjectorBlend(id: string, index: number, value: string) {
    const projector = selectedProjector;
    if (!projector || projector.id !== id) return;
    const next = [...projector.edgeBlend] as [number, number, number, number];
    next[index] = Math.max(0, Math.min(0.5, parseFloat(value) || 0));
    updateProjector(id, { edgeBlend: next });
  }

  function removeObjectFromList(event: MouseEvent, id: string) {
    event.stopPropagation();
    projectionSimScene.removeObject(id);
  }

  function removeProjectorFromList(event: MouseEvent, id: string) {
    event.stopPropagation();
    projectionSimScene.removeProjector(id);
  }

  function saveDesign() {
    const blob = new Blob([projectionSimScene.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${($projectionSimScene.name || 'projection-sim').replace(/[^a-z0-9-_ ]/gi, '_')}.ghost-projection.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadDesign() {
    designFileInput?.click();
  }

  function handleDesignFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = projectionSimScene.importJSON(String(reader.result ?? ''));
      if (!ok) alert('That file is not a valid Ghost projection simulator scene.');
      else loadedPresetId = '';
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  async function toggleFullscreen() {
    if (nativeWindowMode && isDesktopApp) {
      try {
        const result = await invoke<{ ok?: boolean; fullScreen?: boolean }>('projection_sim_set_fullscreen', {
          fullScreen: !nativeFullScreen,
        });
        nativeFullScreen = !!result.fullScreen;
        return;
      } catch (err) {
        console.warn('[ProjectionSim] Native fullscreen failed, falling back to document fullscreen:', err);
      }
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await rootEl?.requestFullscreen?.();
    }
  }

  function togglePanels() {
    panelsHidden = !panelsHidden;
  }

  async function startRecording() {
    if (recorderHandle || !canvas) return;
    if (isDesktopApp && renderer) {
      const nativeRenderer = renderer;
      recordingDuration = 0;
      try {
        const caps = await getNativeRendererCapabilities();
        const nativeProjectionReady = !!(
          caps?.core_capabilities_confirmed &&
          caps?.features?.native_projection_sim &&
          caps?.features?.native_projection_sim_recording_parity &&
          caps?.features?.native_recording &&
          caps?.features?.frame_snapshot_export &&
          caps?.implemented_methods?.includes('set_projection_sim_scene') &&
          caps?.implemented_methods?.includes('export_frame_snapshot')
        );
        if (nativeProjectionReady) {
          recorderHandle = await startNativeRendererLiveFrameRecording({
            width: 1920,
            height: 1080,
            fps: 30,
            quality: 'high',
            namePrefix: 'Projection Simulator',
            prepareFrame: async () => {
              await setNativeRendererProjectionSimScene({
                ...cloneSceneValue(get(projectionSimScene)),
                camera: nativeRenderer.getCameraState(),
              });
            },
            restore: async () => {
              // Clear rather than re-push: a scene left set keeps ghosting
              // the sim geometry into the live composite after recording.
              await setNativeRendererProjectionSimScene(null);
            },
            onDurationUpdate: (seconds) => { recordingDuration = seconds; },
            onComplete: () => {
              isRecording = false;
              recorderHandle = null;
              recordingUsesNative = false;
            },
            onError: (err) => {
              isRecording = false;
              recorderHandle = null;
              recordingUsesNative = false;
              alert(err.message || 'Projection simulator recording failed');
            },
          });
          if (recorderHandle) {
            recordingUsesNative = true;
            isRecording = true;
            return;
          }
        }
      } catch (err) {
        console.warn('[ProjectionSim] Native renderer recording unavailable, falling back to live canvas capture:', err);
      }

      try {
        recorderHandle = await startNativeLiveFrameRecording({
          captureFrame: (width, height) => nativeRenderer.captureFrameAt(width, height),
          width: 1920,
          height: 1080,
          fps: 30,
          quality: 'high',
          namePrefix: 'Projection Simulator',
          onDurationUpdate: (seconds) => { recordingDuration = seconds; },
          onComplete: () => {
            isRecording = false;
            recorderHandle = null;
            recordingUsesNative = false;
          },
          onError: (err) => {
            isRecording = false;
            recorderHandle = null;
            recordingUsesNative = false;
            alert(err.message || 'Projection simulator recording failed');
          },
        });
        if (recorderHandle) {
          recordingUsesNative = true;
          isRecording = true;
          return;
        }
      } catch (err) {
        console.warn('[ProjectionSim] Native recording unavailable, falling back to MediaRecorder:', err);
      }
    }

    const recordCanvas = renderer?.beginRecording(1920, 1080) ?? canvas;
    recordingDuration = 0;
    recordingUsesNative = false;
    recorderHandle = startCanvasRecording({
      namePrefix: 'Projection Simulator',
      canvas: recordCanvas,
      onDurationUpdate: (seconds) => { recordingDuration = seconds; },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
        recordingUsesNative = false;
        renderer?.endRecording();
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        recordingUsesNative = false;
        renderer?.endRecording();
        alert(err.message || 'Projection simulator recording failed');
      },
    });
    isRecording = !!recorderHandle;
    if (!isRecording) renderer?.endRecording();
  }

  function stopRecording() {
    const wasNative = recordingUsesNative;
    recorderHandle?.stop();
    recorderHandle = null;
    isRecording = false;
    recordingUsesNative = false;
    if (!wasNative) renderer?.endRecording();
  }

  function startCalibration(projector: ProjectionSimProjector) {
    calibratingId = projector.id;
    calibrationPointId = null;
    calibrationCursor = null;
    renderer?.setPickMode('calibrate', handleModelPick);
  }

  function stopCalibration() {
    const id = overlaySentFor;
    calibratingId = null;
    calibrationPointId = null;
    calibrationCursor = null;
    padPreview = null;
    renderer?.setPickMode('select');
    if (id && isDesktopApp) {
      overlaySentFor = null;
      void invoke('native_renderer_set_projection_sim_overlay', { projector_id: id, overlay: null }).catch(() => {});
    }
  }

  function clampToImage(point: [number, number], size: [number, number]): [number, number] {
    return [
      Math.max(0, Math.min(size[0] - 1, point[0])),
      Math.max(0, Math.min(size[1] - 1, point[1])),
    ];
  }

  function cursorFor(pointWorld: [number, number, number]): [number, number] {
    if (!calibratingProjector || !calibration) return [0, 0];
    const size = calibration.imageSize;
    const predicted = predictImagePoint(calibratingProjector, calibration, pointWorld);
    const inside = predicted && predicted[0] >= 0 && predicted[1] >= 0 && predicted[0] < size[0] && predicted[1] < size[1];
    return inside ? [Math.round(predicted![0]), Math.round(predicted![1])] : [Math.round(size[0] / 2), Math.round(size[1] / 2)];
  }

  /** Store a calibration edit and, with enough matches, solve and move the
   *  projector in the same undo step. */
  function commitCalibration(next: ProjectionSimCalibration) {
    const projector = calibratingProjector;
    if (!projector) return;
    const matched = matchedPoints(next).length;
    let patch: Partial<ProjectionSimProjector> | undefined;
    let record = next;
    if (canSolve(next)) {
      const solved = solveCalibration(projector, next);
      record = { ...next, result: solved.result };
      if (solved.patch) patch = solved.patch;
    } else {
      record = {
        ...next,
        result: matched
          ? {
              ok: false,
              rms: 0,
              errors: {},
              mode: next.fixedIntrinsics ? 'fixed' : 'free',
              message: `Match ${MIN_CALIBRATION_POINTS - matched} more point${MIN_CALIBRATION_POINTS - matched === 1 ? '' : 's'} to solve.`,
              solvedAt: Date.now(),
            }
          : null,
      };
    }
    projectionSimScene.updateCalibration(projector.id, () => record, patch);
  }

  function handleModelPick(pick: ProjectionSimModelPick) {
    if (!calibration) return;
    const point = { id: newCalibrationPointId(), world: pick.world, image: null, objectId: pick.objectId, enabled: true };
    commitCalibration({ ...calibration, points: [...calibration.points, point] });
    calibrationPointId = point.id;
    calibrationCursor = cursorFor(point.world);
  }

  function selectCalibrationPoint(id: string) {
    const point = calibration?.points.find((p) => p.id === id);
    if (!point) return;
    calibrationPointId = id;
    calibrationCursor = point.image ? [point.image[0], point.image[1]] : cursorFor(point.world);
  }

  function setCalibrationPointImage() {
    if (!calibration || !calibrationPointId || !calibrationCursor) return;
    const image = [Math.round(calibrationCursor[0] * 10) / 10, Math.round(calibrationCursor[1] * 10) / 10] as [number, number];
    commitCalibration({
      ...calibration,
      points: calibration.points.map((point) => (point.id === calibrationPointId ? { ...point, image } : point)),
    });
    calibrationPointId = null;
  }

  function removeCalibrationPoint(id: string) {
    if (!calibration) return;
    commitCalibration({ ...calibration, points: calibration.points.filter((point) => point.id !== id) });
    if (calibrationPointId === id) {
      calibrationPointId = null;
      calibrationCursor = null;
    }
  }

  function clearCalibrationPoints() {
    if (!calibration || !calibration.points.length) return;
    if (!confirm('Remove every calibration point for this projector?')) return;
    commitCalibration({ ...calibration, points: [], result: null });
    calibrationPointId = null;
    calibrationCursor = null;
  }

  function setCalibrationFixedLens(fixed: boolean) {
    if (!calibration) return;
    commitCalibration({ ...calibration, fixedIntrinsics: fixed });
  }

  /** Change the output resolution the points are measured in; matched
   *  points scale with it so they stay on the same features. */
  function setCalibrationImageSize(width: number, height: number) {
    if (!calibration || !calibratingProjector) return;
    const w = Math.round(Math.max(16, Math.min(16384, width || 0)));
    const h = Math.round(Math.max(16, Math.min(16384, height || 0)));
    const [oldW, oldH] = calibration.imageSize;
    if (w === oldW && h === oldH) return;
    const scale = (point: [number, number]) => [point[0] * (w / oldW), point[1] * (h / oldH)] as [number, number];
    projectionSimScene.updateProjector(calibratingProjector.id, { aspect: w / h });
    commitCalibration({
      ...calibration,
      imageSize: [w, h],
      points: calibration.points.map((point) => (point.image ? { ...point, image: scale(point.image) } : point)),
    });
    if (calibrationCursor) calibrationCursor = scale(calibrationCursor);
  }

  function nudgeCalibrationCursor(dx: number, dy: number) {
    if (!calibration || !calibrationCursor) return;
    calibrationCursor = clampToImage([calibrationCursor[0] + dx, calibrationCursor[1] + dy], calibration.imageSize);
  }

  function queueOverlay() {
    if (!isDesktopApp || !calibratingId) return;
    if (overlayInFlight) {
      overlayQueued = true;
      return;
    }
    overlayInFlight = true;
    requestAnimationFrame(() => void sendOverlay());
  }

  async function sendOverlay() {
    const projector = calibratingProjector;
    const current = calibration;
    try {
      if (projector && current) {
        const [w, h] = current.imageSize;
        const overlay = {
          mode: calibrationOutputMode,
          cursor: calibrationCursor ? [calibrationCursor[0] / w, calibrationCursor[1] / h] : null,
          markers: current.points
            .filter((point) => point.image)
            .slice(0, 32)
            .map((point) => [point.image![0] / w, point.image![1] / h, point.id === calibrationPointId ? 1 : 0]),
        };
        overlaySentFor = projector.id;
        await invoke('native_renderer_set_projection_sim_overlay', { projector_id: projector.id, overlay });
      }
    } catch {
      /* the core may be restarting; the next change resends */
    } finally {
      overlayInFlight = false;
      if (overlayQueued) {
        overlayQueued = false;
        queueOverlay();
      }
    }
  }

  function padSize(): { w: number; h: number } {
    const rect = padCanvas?.getBoundingClientRect();
    return { w: Math.max(1, rect?.width ?? 1), h: Math.max(1, rect?.height ?? 1) };
  }

  function padToImage(clientX: number, clientY: number): [number, number] | null {
    if (!padCanvas || !calibration) return null;
    const rect = padCanvas.getBoundingClientRect();
    const [w, h] = calibration.imageSize;
    return clampToImage([((clientX - rect.left) / rect.width) * w, ((clientY - rect.top) / rect.height) * h], [w, h]);
  }

  function handlePadPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !calibration) return;
    event.preventDefault();
    padCanvas?.setPointerCapture(event.pointerId);
    const fine = event.shiftKey || event.altKey;
    padDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, fine };
    if (!calibrationPointId) return;
    if (!fine || !calibrationCursor) calibrationCursor = padToImage(event.clientX, event.clientY);
  }

  function handlePadPointerMove(event: PointerEvent) {
    if (!padDrag || padDrag.pointerId !== event.pointerId || !calibration || !calibrationPointId) return;
    if (padDrag.fine && calibrationCursor) {
      // Fine drag: an eighth of the pointer's travel, for sub-pad-pixel aim.
      const { w, h } = padSize();
      const [iw, ih] = calibration.imageSize;
      nudgeCalibrationCursor(((event.clientX - padDrag.x) / w) * iw / 8, ((event.clientY - padDrag.y) / h) * ih / 8);
    } else {
      calibrationCursor = padToImage(event.clientX, event.clientY);
    }
    padDrag = { ...padDrag, x: event.clientX, y: event.clientY };
  }

  function handlePadPointerUp(event: PointerEvent) {
    if (padDrag?.pointerId === event.pointerId) {
      padCanvas?.releasePointerCapture(event.pointerId);
      padDrag = null;
    }
  }

  function refreshPadPreview(now: number) {
    if (!calibratingProjector || !renderer || !padCanvas) return;
    if (now - padPreviewAt < 100) return;
    padPreviewAt = now;
    const { w, h } = padSize();
    padPreview = renderer.renderProjectorPreview(calibratingProjector.id, Math.round(w), Math.round(h));
    drawPad();
  }

  function drawPad() {
    if (!padCanvas || !calibration || !calibratingProjector) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const { w, h } = padSize();
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (padCanvas.width !== bw || padCanvas.height !== bh) {
      padCanvas.width = bw;
      padCanvas.height = bh;
    }
    const ctx = padCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, bw, bh);
    if (padPreview) {
      const bitmap = document.createElement('canvas');
      bitmap.width = padPreview.width;
      bitmap.height = padPreview.height;
      bitmap.getContext('2d')?.putImageData(padPreview, 0, 0);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bitmap, 0, 0, bw, bh);
      ctx.globalAlpha = 1;
    }
    const [iw, ih] = calibration.imageSize;
    const sx = bw / iw;
    const sy = bh / ih;
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    calibration.points.forEach((point, index) => {
      const selected = point.id === calibrationPointId;
      const predicted = predictImagePoint(calibratingProjector!, calibration!, point.world);
      if (predicted) {
        // Where the virtual projector puts this model point.
        const px = predicted[0] * sx;
        const py = predicted[1] * sy;
        ctx.strokeStyle = 'rgba(255, 90, 170, 0.9)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(px - 5 * dpr, py - 5 * dpr); ctx.lineTo(px + 5 * dpr, py + 5 * dpr);
        ctx.moveTo(px + 5 * dpr, py - 5 * dpr); ctx.lineTo(px - 5 * dpr, py + 5 * dpr);
        ctx.stroke();
        if (point.image) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(point.image[0] * sx, point.image[1] * sy);
          ctx.stroke();
        }
      }
      if (!point.image) return;
      const x = point.image[0] * sx;
      const y = point.image[1] * sy;
      ctx.strokeStyle = selected ? blue(300) : '#ffcf3a';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = selected ? blue(300) : '#ffcf3a';
      ctx.fillText(String(index + 1), x + 10 * dpr, y - 9 * dpr);
    });
    if (calibrationCursor && calibrationPointId) {
      const x = calibrationCursor[0] * sx;
      const y = calibrationCursor[1] * sy;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(x - 6 * dpr, y);
      ctx.moveTo(x + 6 * dpr, y); ctx.lineTo(bw, y);
      ctx.moveTo(x, 0); ctx.lineTo(x, y - 6 * dpr);
      ctx.moveTo(x, y + 6 * dpr); ctx.lineTo(x, bh);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 12 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff3355';
      ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
    }
  }

  function formatError(value: number | undefined): string {
    return value === undefined ? '' : value < 10 ? value.toFixed(2) : value.toFixed(1);
  }

  function updateProjectorLens(id: string, index: 0 | 1, percent: string) {
    const projector = selectedProjector;
    if (!projector || projector.id !== id) return;
    const next = [...(projector.lensShift ?? [0, 0])] as [number, number];
    next[index] = Math.max(-2, Math.min(2, (parseFloat(percent) || 0) / 100));
    updateProjector(id, { lensShift: next });
  }

  function updateProjectorThrowRatio(id: string, value: string) {
    const projector = selectedProjector;
    const ratio = parseFloat(value);
    if (!projector || projector.id !== id || !(ratio > 0)) return;
    updateProjector(id, { fov: Math.round(fovFromThrowRatio(ratio, projector.aspect) * 1000) / 1000 });
  }

  function tick(now: number = performance.now()) {
    renderer?.render($projectionSimScene, sourceCanvas, $settings.output.slices);
    if (calibratingId) refreshPadPreview(now);
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    renderer = new ProjectionSimulatorRenderer(canvas, {
      onSelect: (target, event) => select(target, !!(event?.shiftKey || event?.metaKey || event?.ctrlKey)),
      onTransform: handleTransform,
    });
    renderer.setGizmoMode($projectionSimGizmoMode);
    renderer.setPickProjectors(editProjectors);
    renderer.setSelection($selectedProjectionSimTarget);
    renderer.setSelections([...$selectedProjectionSimTargets]);
    raf = requestAnimationFrame(tick);
    if (import.meta.env.DEV) {
      // Test hook (dev builds only): read where the model sits on screen so
      // automated checks can aim real CDP mouse input at it.
      (window as any).__projectionSimDebug = {
        worldToClient: (world: [number, number, number]) => renderer?.worldToClient(world) ?? null,
        scene: () => get(projectionSimScene),
        calibration: () => ({ calibratingId, calibrationPointId, calibrationCursor }),
      };
    }

    if (nativeWindowMode && isDesktopApp) {
      invoke<{ ok?: boolean; fullScreen?: boolean }>('projection_sim_get_fullscreen')
        .then((result) => { nativeFullScreen = !!result.fullScreen; })
        .catch(() => { /* non-native fallback */ });
      removeNativeFullscreenListener = (window as any).electronAPI?.on?.(
        'projection-sim-fullscreen-changed',
        (payload: { fullScreen?: boolean }) => { nativeFullScreen = !!payload?.fullScreen; },
      ) ?? null;
    }
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    if (isDesktopApp) void setNativeRendererProjectionSimScene(null).catch(() => {});
    if (calibratingId) stopCalibration();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', handleKeydown);
    if (snapGuideTimer !== null) window.clearTimeout(snapGuideTimer);
    snapGuideTimer = null;
    if (nativeScenePublishTimer) {
      clearTimeout(nativeScenePublishTimer);
      nativeScenePublishTimer = null;
    }
    removeNativeFullscreenListener?.();
    removeNativeFullscreenListener = null;
    const wasNative = recordingUsesNative;
    recorderHandle?.stop();
    recorderHandle = null;
    recordingUsesNative = false;
    if (!wasNative) renderer?.endRecording();
    renderer?.dispose();
    renderer = null;
  });

  $: renderer?.setGizmoMode($projectionSimGizmoMode);
  $: renderer?.setPickProjectors(editProjectors);
  $: renderer?.setSelection($selectedProjectionSimTarget);
  $: renderer?.setSelections([...$selectedProjectionSimTargets]);
</script>

<div data-help-page="projection-simulator" class="projection-sim-root" bind:this={rootEl}>
  <canvas class="sim-canvas" bind:this={canvas}></canvas>

  {#if !panelsHidden}
    {#if snapGuides.length}
      <div class="snap-hud">
        {#each snapGuides as guide}
          <span>{guide.label}</span>
        {/each}
      </div>
    {/if}

    <header class="sim-topbar">
      <button class="icon-btn" onclick={close} aria-label="Back to mapping" title="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <div class="brand">PROJECTION<b>SIM</b></div>

      <div class="toolbar-cluster primary-actions" aria-label="Scene file actions">
        <button class="tbtn primary" onclick={newBlankScene} title="New blank scene">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>
          <span>New</span>
        </button>
        <button class="tbtn primary" onclick={saveDesign} title="Save projection sim scene">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
          <span>Save</span>
        </button>
        <button class="tbtn primary" onclick={loadDesign} title="Load projection sim scene">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2"/></svg>
          <span>Load</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-cluster edit-actions" aria-label="Edit actions">
        <button class="tbtn" disabled={!canUndoScene} onclick={undoScene} title="Undo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/></svg>
          <span>Undo</span>
        </button>
        <button class="tbtn" disabled={!canRedoScene} onclick={redoScene} title="Redo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a5 5 0 0 0 0 10h2"/></svg>
          <span>Redo</span>
        </button>
        <button class="tbtn" disabled={!canCopySceneItem} onclick={copySelectedSceneItem} title="Copy selected object">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
          <span>Copy</span>
        </button>
        <button class="tbtn" disabled={!canPasteSceneItem} onclick={pasteSceneItem} title="Paste copied object">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M4 13h8"/><path d="M8 9v8"/></svg>
          <span>Paste</span>
        </button>
        <button class="tbtn danger-mini" disabled={!multiSelectionCount || selectedLocked} onclick={deleteSelected} title="Delete selected object">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          <span>Delete</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="seg" role="tablist">
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'translate'} onclick={() => setGizmo('translate')} title="Move objects">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2l3 3"/><path d="M12 2L9 5"/><path d="M12 22l3-3"/><path d="M12 22l-3-3"/><path d="M2 12l3-3"/><path d="M2 12l3 3"/><path d="M22 12l-3-3"/><path d="M22 12l-3 3"/></svg>
          <span>Move</span>
        </button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'rotate'} onclick={() => setGizmo('rotate')} title="Rotate objects">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v7h-7"/></svg>
          <span>Rotate</span>
        </button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'scale'} onclick={() => setGizmo('scale')} title="Scale objects">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v6h6"/><path d="M20 10V4h-6"/><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M14 10l6-6"/><path d="M4 20l6-6"/></svg>
          <span>Scale</span>
        </button>
      </div>

      <div class="toolbar-cluster view-actions" aria-label="View and mapping actions">
        <button class="tbtn" onclick={() => renderer?.frameCamera()} title="Frame scene">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>
          <span>Frame</span>
        </button>
        <button class="tbtn" onclick={() => renderer?.topCamera()} title="Top camera">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 5-8 5-8-5z"/><path d="M4 13l8 5 8-5"/></svg>
          <span>Top</span>
        </button>
        <button class="tbtn" class:on={snapEnabled} onclick={() => snapEnabled = !snapEnabled} title="Toggle snapping">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><path d="M6 7h4"/><path d="M14 7h4"/><path d="M6 21v-4"/><path d="M18 21v-4"/></svg>
          <span>Snap</span>
        </button>
        <button class="tbtn" class:on={editProjectors} onclick={() => editProjectors = !editProjectors} title="Toggle projector selection">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H4z"/><path d="M16 10l5-3v10l-5-3"/><path d="M7 12h3"/></svg>
          <span>Projectors</span>
        </button>
        <button class="tbtn" onclick={syncProjectorsFromSlices} title="Sync projectors from screen slices">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10"/><path d="M10 3l4 4-4 4"/><path d="M20 17H10"/><path d="M14 13l-4 4 4 4"/></svg>
          <span>Sync Slices</span>
        </button>
        <button class="tbtn" onclick={toggleFullscreen} title="Fullscreen output">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>
          <span>Full Screen</span>
        </button>
      </div>

      <div class="spacer"></div>

      {#if isRecording}
        <button class="tbtn rec recording" onclick={stopRecording}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10"/></svg>
          <span>Stop {formatRecordingDuration(recordingDuration)}</span>
        </button>
      {:else}
        <button class="tbtn rec" onclick={startRecording}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>
          <span>Rec</span>
        </button>
      {/if}
      <button class="tbtn" onclick={togglePanels} title="Hide controls">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"/><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 8.3 4 10 8a16.7 16.7 0 0 1-2.1 3.4"/><path d="M6.6 6.6A15.4 15.4 0 0 0 2 12c1.7 4 5 8 10 8a10.8 10.8 0 0 0 4.1-.8"/></svg>
        <span>Hide</span>
      </button>
    </header>

    <aside class="sim-left">
      <section>
        <h3>Presets</h3>
        <div class="preset-picker">
          <label class="field mini">
            <span>Structure</span>
            <select
              value={selectedPresetId}
              onpointerdown={(event) => event.stopPropagation()}
              onmousedown={(event) => event.stopPropagation()}
              onclick={(event) => event.stopPropagation()}
              onchange={handlePresetSelect}
            >
              {#each PROJECTION_SIM_PRESETS as preset}
                <option value={preset.id}>{preset.name}</option>
              {/each}
            </select>
          </label>
          <p class="empty">{selectedPreset?.description}</p>
          <button class="wide-btn" onclick={() => applyPreset(selectedPresetId)}>Load Preset</button>
        </div>
      </section>

      <section>
        <h3>Build</h3>
        <div class="primitive-grid">
          {#each primitiveKinds as kind}
            <button class="add-btn" onclick={() => addPrimitive(kind)}>{kind}</button>
          {/each}
        </div>
        <button class="wide-btn" onclick={addProjector}>Add Projector</button>
        <button class="wide-btn" onclick={triggerImport}>Import Model / PLY</button>
        <input bind:this={fileInput} type="file" accept=".glb,.gltf,.obj,.fbx,.ply" style="display:none" onchange={handleImportFile} />
        <input bind:this={designFileInput} type="file" accept=".json,.ghost-projection" style="display:none" onchange={handleDesignFile} />
      </section>

      <section>
        <h3>Arrange</h3>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapEnabled} />
          <span>Snap</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapTouch} disabled={!snapEnabled} />
          <span>Touch edges</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapEqualSpacing} disabled={!snapEnabled} />
          <span>Match gaps</span>
        </label>
        <label class="field">
          <span>Snap distance {snapThreshold.toFixed(2)}</span>
          <input type="range" min="0.02" max="0.5" step="0.01" bind:value={snapThreshold} disabled={!snapEnabled} />
        </label>
        <div class="arrange-grid">
          <button class="add-btn" onclick={() => spaceEvenly('x')}>Space X</button>
          <button class="add-btn" onclick={() => spaceEvenly('y')}>Space Y</button>
          <button class="add-btn" onclick={() => spaceEvenly('z')}>Space Z</button>
        </div>
      </section>

      <section>
        <h3>Scene</h3>
        <label class="field mini">
          <span>Name</span>
          <input value={$projectionSimScene.name} oninput={(e) => projectionSimScene.setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Room exposure {($projectionSimScene.environment.roomExposure ?? 1.15).toFixed(2)}</span>
          <input type="range" min="0.25" max="2.4" step="0.05" value={$projectionSimScene.environment.roomExposure ?? 1.15} oninput={(e) => projectionSimScene.setEnvironment({ roomExposure: parseFloat((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="field">
          <span>Surface style</span>
          <select value={$projectionSimScene.environment.surfaceStyle ?? 'light-gray'} onchange={(e) => projectionSimScene.setEnvironment({ surfaceStyle: (e.target as HTMLSelectElement).value as ProjectionSimScene['environment']['surfaceStyle'] })}>
            <option value="light-gray">Light gray mapping surface</option>
            <option value="white">White mapping surface</option>
            <option value="dark-gray">Dark gray mapping surface</option>
            <option value="original">Preset material colors</option>
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={$projectionSimScene.environment.shadows} onchange={(e) => projectionSimScene.setEnvironment({ shadows: (e.target as HTMLInputElement).checked })} />
          <span>Projector shadows</span>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={$projectionSimScene.environment.showFloorProjection ?? true} onchange={(e) => projectionSimScene.setEnvironment({ showFloorProjection: (e.target as HTMLInputElement).checked })} />
          <span>Projection on floor</span>
        </label>
        <label class="field">
          <span>Shadow strength {Math.round(($projectionSimScene.environment.shadowStrength ?? 1) * 100)}%</span>
          <input type="range" min="0" max="1" step="0.01" value={$projectionSimScene.environment.shadowStrength ?? 1} oninput={(e) => projectionSimScene.setEnvironment({ shadowStrength: parseFloat((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="check-row">
          <input type="checkbox" checked={$projectionSimScene.environment.showGrid} onchange={(e) => projectionSimScene.setEnvironment({ showGrid: (e.target as HTMLInputElement).checked })} />
          <span>Floor grid</span>
        </label>
      </section>

      <section>
        <h3>Objects</h3>
        <div class="tree">
          {#each $projectionSimScene.objects as object}
            {@const key = `object:${object.id}`}
            <div class="tree-item" class:selected={isSelectedTarget(key)} class:primary={$selectedProjectionSimTarget === key}>
              <button class="tree-row" onclick={(event) => selectFromEvent(event, key)} title="Shift+click to add/remove from selection">
                <span>{object.type === 'pointcloud' ? 'PLY' : object.primitive ?? 'model'}</span>
                <b>{object.name}</b>
              </button>
              <button
                class="tree-lock"
                class:locked={object.locked}
                onclick={(e) => toggleObjectLock(e, object.id)}
                aria-label={`${object.locked ? 'Unlock' : 'Lock'} ${object.name}`}
                title={object.locked ? 'Unlock' : 'Lock'}
              >{object.locked ? 'Locked' : 'Lock'}</button>
              <button class="tree-delete" disabled={object.locked} onclick={(e) => removeObjectFromList(e, object.id)} aria-label={`Delete ${object.name}`}>×</button>
            </div>
          {/each}
        </div>
      </section>

      <section>
        <h3>Projectors</h3>
        <div class="tree">
          {#each $projectionSimScene.projectors as projector}
            {@const key = `projector:${projector.id}`}
            <div class="tree-item" class:selected={isSelectedTarget(key)} class:primary={$selectedProjectionSimTarget === key}>
              <button class="tree-row projector" onclick={(event) => selectFromEvent(event, key)} title="Shift+click to add/remove from selection">
                <span>{projector.source}</span>
                <b>{projector.name}</b>
              </button>
              <button
                class="tree-lock"
                class:locked={projector.locked}
                onclick={(e) => toggleProjectorLock(e, projector.id)}
                aria-label={`${projector.locked ? 'Unlock' : 'Lock'} ${projector.name}`}
                title={projector.locked ? 'Unlock' : 'Lock'}
              >{projector.locked ? 'Locked' : 'Lock'}</button>
              <button class="tree-delete" disabled={projector.locked} onclick={(e) => removeProjectorFromList(e, projector.id)} aria-label={`Delete ${projector.name}`}>×</button>
            </div>
          {/each}
        </div>
      </section>
    </aside>

    <aside class="sim-right">
      {#if multiSelectionCount > 1}
        <section>
          <h3>{multiSelectionCount} items selected</h3>
          <p class="empty">Use Move, Rotate, or Scale to transform the selected items together. Locked items stay protected.</p>
          <button class="danger wide-btn" disabled={selectedLocked} onclick={deleteSelected}>Delete Selection</button>
        </section>
      {:else if selectedObject}
        <section>
          <h3>{selectedObject.name}</h3>
          <label class="field">
            <span>Name</span>
            <input value={selectedObject.name} oninput={(e) => updateObject(selectedObject.id, { name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.locked} onchange={() => projectionSimScene.toggleObjectLock(selectedObject!.id)} />
            <span>Locked</span>
          </label>
          <div class="triple">
            <label>Pos X<input type="number" step="0.1" value={selectedObject.position[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" step="0.1" value={selectedObject.position[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>Z<input type="number" step="0.1" value={selectedObject.position[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>Scale X<input type="number" step="0.1" value={selectedObject.scale[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" step="0.1" value={selectedObject.scale[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>Z<input type="number" step="0.1" value={selectedObject.scale[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>Rot X<input type="number" step="0.05" value={selectedObject.rotation[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" step="0.05" value={selectedObject.rotation[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>Z<input type="number" step="0.05" value={selectedObject.rotation[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>Surface color</span>
            <input type="color" value={selectedObject.color} oninput={(e) => updateObject(selectedObject.id, { color: (e.target as HTMLInputElement).value })} />
          </label>
          {#if selectedObject.type === 'pointcloud'}
            <label class="field">
              <span>Point size</span>
              <input type="range" min="0.005" max="0.12" step="0.005" value={selectedObject.pointSize ?? 0.035} oninput={(e) => updateObject(selectedObject.id, { pointSize: parseFloat((e.target as HTMLInputElement).value) })} />
            </label>
          {/if}
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.receiveProjection} disabled={selectedObject.type === 'pointcloud'} onchange={(e) => updateObject(selectedObject.id, { receiveProjection: (e.target as HTMLInputElement).checked })} />
            <span>Receive projection</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.visible} onchange={(e) => updateObject(selectedObject.id, { visible: (e.target as HTMLInputElement).checked })} />
            <span>Visible</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.castShadow} onchange={(e) => updateObject(selectedObject.id, { castShadow: (e.target as HTMLInputElement).checked })} />
            <span>Cast shadow</span>
          </label>
          <button class="danger wide-btn" disabled={selectedObject.locked} onclick={() => projectionSimScene.removeObject(selectedObject!.id)}>Delete Object</button>
        </section>
      {:else if selectedProjector}
        <section>
          <h3>{selectedProjector.name}</h3>
          <label class="field">
            <span>Name</span>
            <input value={selectedProjector.name} oninput={(e) => updateProjector(selectedProjector.id, { name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.locked} onchange={() => projectionSimScene.toggleProjectorLock(selectedProjector!.id)} />
            <span>Locked</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.enabled} onchange={(e) => updateProjector(selectedProjector.id, { enabled: (e.target as HTMLInputElement).checked })} />
            <span>Enabled</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.showFrustum} onchange={(e) => updateProjector(selectedProjector.id, { showFrustum: (e.target as HTMLInputElement).checked })} />
            <span>Show beam</span>
          </label>
          <div class="triple">
            <label>Pos X<input type="number" step="0.1" value={selectedProjector.position[0]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" step="0.1" value={selectedProjector.position[1]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>Z<input type="number" step="0.1" value={selectedProjector.position[2]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>Target X<input type="number" step="0.1" value={selectedProjector.target[0]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" step="0.1" value={selectedProjector.target[1]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>Z<input type="number" step="0.1" value={selectedProjector.target[2]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>FOV {selectedProjector.fov.toFixed(1)}°</span>
            <input type="range" min="5" max="120" step="0.1" value={selectedProjector.fov} disabled={selectedProjector.locked} oninput={(e) => updateProjector(selectedProjector.id, { fov: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <div class="triple">
            <label>Throw ratio<input type="number" min="0.1" max="10" step="0.01" value={projectorThrowRatio(selectedProjector).toFixed(3)} disabled={selectedProjector.locked} onchange={(e) => updateProjectorThrowRatio(selectedProjector.id, (e.target as HTMLInputElement).value)} /></label>
            <label>Shift X %<input type="number" step="1" value={Math.round((selectedProjector.lensShift?.[0] ?? 0) * 1000) / 10} disabled={selectedProjector.locked} onchange={(e) => updateProjectorLens(selectedProjector.id, 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Shift Y %<input type="number" step="1" value={Math.round((selectedProjector.lensShift?.[1] ?? 0) * 1000) / 10} disabled={selectedProjector.locked} onchange={(e) => updateProjectorLens(selectedProjector.id, 1, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>Roll {(selectedProjector.roll ?? 0).toFixed(1)}°</span>
            <input type="range" min="-180" max="180" step="0.1" value={selectedProjector.roll ?? 0} disabled={selectedProjector.locked} oninput={(e) => updateProjector(selectedProjector.id, { roll: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>Content from</span>
            <select value={selectedProjector.contentFrom ?? ''} onchange={(e) => updateProjector(selectedProjector.id, { contentFrom: (e.target as HTMLSelectElement).value || null })}>
              <option value="">This projector's lens</option>
              {#each $projectionSimScene.projectors.filter((p) => p.id !== selectedProjector?.id) as other (other.id)}
                <option value={other.id}>{other.name}'s lens</option>
              {/each}
            </select>
          </label>
          <p class="empty">
            {selectedProjector.contentFrom
              ? 'The content is fixed to the model as the other lens throws it; this projector adds it from its own position.'
              : 'The content is thrown from this lens, as the projector itself would.'}
          </p>
          <button class="wide-btn" class:on={calibratingId === selectedProjector.id} disabled={selectedProjector.locked}
            onclick={() => (calibratingId === selectedProjector?.id ? stopCalibration() : startCalibration(selectedProjector!))}>
            {calibratingId === selectedProjector.id ? 'Close calibration' : 'Calibrate to real projector'}
          </button>
          {#if selectedProjector.calibration?.result?.ok}
            <p class="empty">Calibrated: {selectedProjector.calibration.result.rms.toFixed(2)} px RMS over {Object.keys(selectedProjector.calibration.result.errors).length} points.</p>
          {/if}
          <label class="field">
            <span>Intensity {selectedProjector.intensity.toFixed(1)}</span>
            <input type="range" min="0" max="20" step="0.1" value={selectedProjector.intensity} oninput={(e) => updateProjector(selectedProjector.id, { intensity: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>Opacity {Math.round(selectedProjector.opacity * 100)}%</span>
            <input type="range" min="0" max="1" step="0.01" value={selectedProjector.opacity} oninput={(e) => updateProjector(selectedProjector.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>Source</span>
            <select value={selectedProjector.source} onchange={(e) => updateProjector(selectedProjector.id, { source: (e.target as HTMLSelectElement).value as 'master' | 'slice' })}>
              <option value="master">Master canvas</option>
              <option value="slice">Output slice</option>
            </select>
          </label>
          {#if selectedProjector.source === 'slice'}
            <label class="field">
              <span>Slice</span>
              <select value={selectedProjector.sliceId ?? ''} onchange={(e) => updateProjector(selectedProjector.id, { sliceId: (e.target as HTMLSelectElement).value || null })}>
                <option value="">Manual crop</option>
                {#each $settings.output.slices as slice}
                  <option value={slice.id}>{slice.name}</option>
                {/each}
              </select>
            </label>
          {/if}
          <div class="quad">
            <label>Crop X<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[0]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 0, (e.target as HTMLInputElement).value)} /></label>
            <label>Y<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[1]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 1, (e.target as HTMLInputElement).value)} /></label>
            <label>W<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[2]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 2, (e.target as HTMLInputElement).value)} /></label>
            <label>H<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[3]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 3, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="quad">
            <label>Blend L<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[0]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 0, (e.target as HTMLInputElement).value)} /></label>
            <label>R<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[1]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 1, (e.target as HTMLInputElement).value)} /></label>
            <label>T<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[2]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 2, (e.target as HTMLInputElement).value)} /></label>
            <label>B<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[3]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 3, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>Tint</span>
            <input type="color" value={selectedProjector.color} oninput={(e) => updateProjector(selectedProjector.id, { color: (e.target as HTMLInputElement).value })} />
          </label>
          <button class="danger wide-btn" disabled={selectedProjector.locked} onclick={() => projectionSimScene.removeProjector(selectedProjector!.id)}>Delete Projector</button>
        </section>
      {:else}
        <section>
          <h3>Projection Simulator</h3>
          <p class="empty">Select an object or projector. Projectors sample the live mapping canvas, so layer warps, test patterns, slices, and VJ output all show up on the 3D structure.</p>
        </section>
      {/if}
    </aside>
    {#if calibratingProjector && calibration}
      <div class="psim-calibration-dock" aria-label="Projector calibration" bind:clientHeight={dockHeight}>
        <div class="calib-pad-wrap">
          <canvas
            class="psim-calibration-pad"
            class:armed={!!calibrationPointId}
            bind:this={padCanvas}
            style={`aspect-ratio: ${calibration.imageSize[0]} / ${calibration.imageSize[1]}; width: min(100%, calc(30vh * ${calibration.imageSize[0] / calibration.imageSize[1]}))`}
            onpointerdown={handlePadPointerDown}
            onpointermove={handlePadPointerMove}
            onpointerup={handlePadPointerUp}
            onpointercancel={handlePadPointerUp}
          ></canvas>
          <p class="calib-step">{calibrationStep}</p>
          {#if calibrationCursor && calibrationPointId}
            <div class="calib-cursor-row">
              <span>Crosshair {calibrationCursor[0].toFixed(1)}, {calibrationCursor[1].toFixed(1)} px</span>
              <button class="tbtn primary" onclick={setCalibrationPointImage}>Set point</button>
            </div>
          {/if}
        </div>
        <div class="calib-side">
          <div class="calib-head">
            <h3>Calibrate {calibratingProjector.name}</h3>
            <button class="tbtn" onclick={stopCalibration}>Done</button>
          </div>
          {#if !calibrationScreens.length}
            <p class="calib-warn">No Screen shows this projector yet. In Screens, set a Screen's Source to Map Sim: {calibratingProjector.name} and open it on the projector's display to see the crosshair on the real object.</p>
          {/if}
          <div class="calib-row">
            <label>Output W<input type="number" min="16" max="16384" step="1" value={calibration.imageSize[0]} onchange={(e) => setCalibrationImageSize(parseFloat((e.target as HTMLInputElement).value), calibration!.imageSize[1])} /></label>
            <label>H<input type="number" min="16" max="16384" step="1" value={calibration.imageSize[1]} onchange={(e) => setCalibrationImageSize(calibration!.imageSize[0], parseFloat((e.target as HTMLInputElement).value))} /></label>
            <label>On projector
              <select value={calibrationOutputMode} onchange={(e) => (calibrationOutputMode = (e.target as HTMLSelectElement).value as CalibrationOutputMode)}>
                <option value="black">Crosshair only</option>
                <option value="model">Model outline</option>
                <option value="content">Content</option>
              </select>
            </label>
          </div>
          <label class="check-row">
            <input type="checkbox" checked={calibration.fixedIntrinsics} onchange={(e) => setCalibrationFixedLens((e.target as HTMLInputElement).checked)} />
            <span>Fixed lens (solve position and aim only)</span>
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={calibrationSnap} />
            <span>Snap to model corners</span>
          </label>
          <div class="calib-points">
            {#each calibration.points as point, index (point.id)}
              <div class="calib-point" class:selected={point.id === calibrationPointId}>
                <button class="calib-point-main" onclick={() => selectCalibrationPoint(point.id)} title="Adjust this point's crosshair">
                  <b>{index + 1}</b>
                  <span>{point.image ? `${point.image[0].toFixed(0)}, ${point.image[1].toFixed(0)}` : 'not matched'}</span>
                  <span class="calib-err">{formatError(calibration.result?.errors?.[point.id])}{calibration.result?.errors?.[point.id] !== undefined ? ' px' : ''}</span>
                </button>
                <button class="tree-delete" onclick={() => removeCalibrationPoint(point.id)} aria-label={`Remove point ${index + 1}`}>×</button>
              </div>
            {:else}
              <p class="empty">Click a corner or edge on the model to start. Points spread across the object and at different depths give the best fit.</p>
            {/each}
          </div>
          <div class="calib-result" class:bad={calibration.result && !calibration.result.ok}>
            {#if calibration.result?.ok}
              <b>RMS {calibration.result.rms.toFixed(2)} px</b>
              <span>{calibrationMatched} points, {calibration.result.mode === 'fixed' ? 'fixed lens' : 'pose and lens'} solved</span>
              {#if calibration.result.warning}<span class="calib-warn">{calibration.result.warning}</span>{/if}
            {:else if calibration.result}
              <span>{calibration.result.message}</span>
            {:else}
              <span>{calibrationMatched} of {MIN_CALIBRATION_POINTS} points matched.</span>
            {/if}
          </div>
          <div class="calib-actions">
            <button class="tbtn" disabled={!canUndoScene} onclick={undoScene}>Undo</button>
            <button class="tbtn" disabled={!canSolve(calibration)} onclick={() => commitCalibration(calibration!)}>Solve again</button>
            <button class="tbtn danger-mini" disabled={!calibration.points.length} onclick={clearCalibrationPoints}>Clear</button>
          </div>
          <p class="empty">Arrow keys nudge the crosshair 1 px (Shift: 10 px). Shift-drag on the pad for fine aim. Enter sets the point, Esc cancels.</p>
        </div>
      </div>
    {/if}
  {:else}
    <button class="show-panels" onclick={togglePanels}>Show Controls</button>
  {/if}
</div>

<style>
  .projection-sim-root {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: #05070b;
    color: var(--ga-ink-0, #eef0f4);
    font-family: var(--ga-font-ui, Inter, system-ui, sans-serif);
    overflow: hidden;
  }
  .sim-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .sim-topbar,
  .sim-left,
  .sim-right,
  .show-panels {
    position: absolute;
    z-index: 2;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    background: color-mix(in srgb, var(--ga-panel, #0b0d11) 97%, #05070b);
    box-shadow: 0 18px 50px rgba(0,0,0,0.35);
  }
  .sim-topbar {
    top: 14px;
    left: 14px;
    right: 14px;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .sim-topbar::-webkit-scrollbar { display: none; }
  .brand {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    letter-spacing: 0.08em;
    font-size: 12px;
    margin-right: 2px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .brand b { color: var(--ga-coral, #ff725f); }
  .spacer { flex: 1; }
  button, input, select {
    font: inherit;
  }
  .icon-btn,
  .tbtn,
  .seg-btn,
  .add-btn,
  .wide-btn,
  .tree-row,
  .tree-lock,
  .tree-delete,
  .show-panels {
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.055);
    color: inherit;
    cursor: pointer;
  }
  .toolbar-cluster {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 3px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(255,255,255,0.025);
    flex: 0 0 auto;
  }
  .toolbar-cluster.primary-actions {
    border-color: rgba(97, 214, 164, 0.18);
    background: linear-gradient(180deg, rgba(97, 214, 164, 0.075), rgba(255,255,255,0.02));
  }
  .toolbar-cluster.edit-actions {
    border-color: var(--ga-blue-a16);
    background: linear-gradient(180deg, var(--ga-blue-a08), rgba(255,255,255,0.02));
  }
  .toolbar-cluster.view-actions {
    border-color: rgba(255,255,255,0.09);
  }
  .toolbar-divider {
    width: 1px;
    height: 28px;
    background: linear-gradient(180deg, transparent, rgba(255,255,255,0.18), transparent);
    flex: 0 0 auto;
  }
  .icon-btn {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .tbtn {
    height: 30px;
    padding: 0 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .tbtn svg,
  .seg-btn svg,
  .icon-btn svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: 0 0 auto;
  }
  .tbtn.primary {
    border-color: rgba(97, 214, 164, 0.30);
    color: #d2ffe5;
    background: rgba(97, 214, 164, 0.08);
  }
  .tbtn.primary:hover {
    border-color: rgba(97, 214, 164, 0.54);
    background: rgba(97, 214, 164, 0.14);
  }
  .tbtn:hover,
  .seg-btn:hover,
  .add-btn:hover,
  .wide-btn:hover,
  .tree-row:hover,
  .tree-lock:hover,
  .tree-delete:hover {
    border-color: rgba(255,255,255,0.28);
    background: rgba(255,255,255,0.1);
  }
  .rec {
    border-color: rgba(255,114,95,0.45);
    color: #ffb4a8;
  }
  .rec.recording {
    background: rgba(255, 80, 70, 0.18);
  }
  .tbtn.on {
    border-color: rgba(97, 214, 164, 0.45);
    background: rgba(97, 214, 164, 0.14);
    color: #bbf7d0;
  }
  .danger-mini {
    border-color: rgba(255, 80, 70, 0.34);
    color: #ffaaa0;
  }
  .tbtn:disabled,
  .add-btn:disabled,
  .wide-btn:disabled,
  .tree-delete:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .seg {
    display: flex;
    border: 1px solid rgba(255,255,255,0.12);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .seg-btn {
    height: 30px;
    border: 0;
    border-right: 1px solid rgba(255,255,255,0.1);
    padding: 0 10px;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .seg-btn:last-child { border-right: 0; }
  .seg-btn.on {
    background: rgba(255,114,95,0.18);
    color: #ffd0c8;
  }
  .sim-left,
  .sim-right {
    top: 76px;
    bottom: 18px;
    width: 288px;
    overflow: auto;
    padding: 14px;
  }
  .sim-left { left: 14px; }
  .sim-right { right: 14px; }
  section + section {
    margin-top: 18px;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ga-ink-2, #9ca3af);
  }
  .preset-picker,
  .primitive-grid,
  .tree {
    display: grid;
    gap: 8px;
  }
  .primitive-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .arrange-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .tree-row b {
    font-size: 12px;
    font-weight: 650;
  }
  .tree-row span,
  .empty {
    font-size: 10px;
    line-height: 1.45;
    color: var(--ga-ink-2, #9ca3af);
  }
  .add-btn,
  .wide-btn {
    min-height: 34px;
    padding: 0 10px;
    text-transform: capitalize;
  }
  .wide-btn {
    width: 100%;
    margin-top: 8px;
  }
  .danger {
    border-color: rgba(255, 80, 70, 0.38);
    color: #ffaaa0;
  }
  .tree-row {
    min-height: 40px;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 68px 1fr;
    gap: 8px;
    align-items: center;
    text-align: left;
  }
  .tree-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 52px 30px;
    gap: 6px;
  }
  .tree-item .tree-row {
    width: 100%;
  }
  .tree-item.selected .tree-row {
    background: rgba(255,114,95,0.16);
    border-color: rgba(255,114,95,0.5);
  }
  .tree-item.primary .tree-row {
    box-shadow: inset 3px 0 0 #ff725f;
  }
  .tree-delete {
    min-height: 40px;
    color: #ffaaa0;
  }
  .tree-lock {
    min-height: 40px;
    padding: 0 6px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--ga-ink-2, #9ca3af);
  }
  .tree-lock.locked {
    border-color: rgba(97, 214, 164, 0.4);
    background: rgba(97, 214, 164, 0.14);
    color: #bbf7d0;
  }
  .field,
  .check-row {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
    font-size: 11px;
    color: var(--ga-ink-2, #9ca3af);
  }
  .field.mini {
    margin-bottom: 12px;
  }
  .field input,
  .field select,
  .triple input,
  .quad input {
    min-width: 0;
    height: 30px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.25);
    color: var(--ga-ink-0, #eef0f4);
    padding: 0 8px;
  }
  .field input[type="color"] {
    padding: 2px;
  }
  .check-row {
    grid-template-columns: 18px 1fr;
    align-items: center;
  }
  .triple,
  .quad {
    display: grid;
    gap: 8px;
    margin-bottom: 10px;
  }
  .triple {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .quad {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .triple label,
  .quad label {
    display: grid;
    gap: 5px;
    font-size: 10px;
    color: var(--ga-ink-2, #9ca3af);
  }
  .show-panels {
    top: 16px;
    right: 16px;
    height: 34px;
    padding: 0 14px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-size: 11px;
  }
  .snap-hud {
    position: absolute;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 3;
    pointer-events: none;
  }
  .snap-hud span {
    min-height: 26px;
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(97, 214, 164, 0.45);
    background: rgba(5, 8, 12, 0.82);
    color: #bbf7d0;
    padding: 0 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    box-shadow: 0 10px 28px rgba(0,0,0,0.34);
  }
  .psim-calibration-dock {
    position: absolute;
    left: 316px;
    right: 316px;
    bottom: 18px;
    z-index: 3;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 12px;
    padding: 10px;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    background: color-mix(in srgb, var(--ga-panel, #0b0d11) 97%, #05070b);
    /* Keep the upper half of the view free for picking points on the model. */
    max-height: 44%;
    overflow: auto;
  }
  .calib-pad-wrap {
    min-width: 0;
    display: grid;
    gap: 8px;
    align-content: start;
  }
  .psim-calibration-pad {
    justify-self: center;
    background: #000;
    border: 1px solid rgba(255,255,255,0.16);
    cursor: default;
    touch-action: none;
  }
  .psim-calibration-pad.armed {
    cursor: crosshair;
    border-color: var(--ga-blue-a45);
  }
  .calib-step {
    margin: 0;
    font-size: 11px;
    color: var(--ga-ink-1, #d7dbe2);
  }
  .calib-cursor-row,
  .calib-head,
  .calib-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ga-ink-2, #9ca3af);
  }
  .calib-head h3 { margin: 0; }
  .calib-actions { justify-content: flex-start; margin: 10px 0 8px; }
  .calib-side { min-width: 0; }
  .calib-row {
    display: grid;
    grid-template-columns: 64px 64px minmax(0, 1fr);
    gap: 8px;
    margin: 10px 0;
  }
  .calib-row label {
    display: grid;
    gap: 5px;
    font-size: 10px;
    color: var(--ga-ink-2, #9ca3af);
  }
  .calib-row input,
  .calib-row select {
    min-width: 0;
    height: 28px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.25);
    color: var(--ga-ink-0, #eef0f4);
    padding: 0 6px;
  }
  .calib-points {
    display: grid;
    gap: 4px;
    max-height: 180px;
    overflow: auto;
  }
  .calib-point {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 30px;
    gap: 4px;
  }
  .calib-point .tree-delete { min-height: 28px; }
  .calib-point-main {
    min-height: 28px;
    display: grid;
    grid-template-columns: 22px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 0 8px;
    text-align: left;
    font-size: 11px;
  }
  .calib-point.selected .calib-point-main {
    border-color: var(--ga-blue-a70);
    background: var(--ga-blue-a16);
  }
  .calib-err { color: #ffcf3a; font-variant-numeric: tabular-nums; }
  .calib-result {
    display: grid;
    gap: 3px;
    margin-top: 10px;
    padding: 8px;
    border: 1px solid rgba(97, 214, 164, 0.35);
    background: rgba(97, 214, 164, 0.08);
    font-size: 11px;
    color: #cdeee0;
  }
  .calib-result b { font-size: 13px; color: #eafff4; }
  .calib-result.bad {
    border-color: rgba(255, 160, 80, 0.4);
    background: rgba(255, 160, 80, 0.08);
    color: #ffd9b8;
  }
  .calib-warn {
    font-size: 10px;
    line-height: 1.45;
    color: #ffd08a;
  }
  .wide-btn.on {
    background: var(--ga-blue-a16);
    border-color: var(--ga-blue-a45);
  }
</style>
