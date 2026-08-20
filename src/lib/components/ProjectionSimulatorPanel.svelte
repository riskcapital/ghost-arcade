<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '../i18n';
  import { settings, type OutputSlice } from '../stores/settings';
  import { workspace } from '../stores/workspace';
  import { invoke, isDesktopApp } from '../bridge';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import { startRecording as startCanvasRecording, formatRecordingDuration, type RecorderHandle,
  } from '../recording/recorder';
  import { ProjectionSimulatorRenderer } from '../projectionSim/ProjectionSimulatorRenderer';
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
  let sceneClipboard:
    | { kind: 'object'; object: ProjectionSimObject } | { kind: 'projector'; projector: ProjectionSimProjector } | null = null;
  let canUndoScene = false;
  let canRedoScene = false;

  const primitiveKinds: ProjectionSimPrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'column', 'plane',
  ];
  const BLANK_PRESET_ID = '__blank__';
  const presetCatalogKeys: Record<string, string> = {
    'cube-pyramid': 'cubePyramid',
    'museum-facade': 'museumFacade',
    'isam-cubes': 'isamCubes',
  };

  function presetLabel(id: string, field: 'names' | 'descriptions', fallback: string): string {
    const catalogKey = presetCatalogKeys[id];
    if (!catalogKey) return fallback;
    const key = `projection.simulator.presets.${field}.${catalogKey}`;
    const translated = $t(key);
    return translated === key ? fallback : translated;
  }

  function primitiveLabel(kind: ProjectionSimPrimitiveKind): string {
    return $t(`projection.simulator.build.primitives.${kind}`);
  }

  function objectTypeLabel(object: ProjectionSimObject): string {
    if (object.type === 'pointcloud') return $t('projection.simulator.objects.pointCloud');
    return object.primitive ? primitiveLabel(object.primitive) : $t('projection.simulator.objects.model');
  }

  function projectorSourceLabel(source: ProjectionSimProjector['source']): string {
    return source === 'master'
      ? $t('projection.simulator.projectors.sourceMaster')
      : $t('projection.simulator.projectors.sourceSlice');
  }

  $: selectedTarget = $selectedProjectionSimTarget;
  $: selectedTargets = $selectedProjectionSimTargets;
  $: selectedTargetList = [...selectedTargets];
  $: multiSelectionCount = selectedTargetList.length;
  $: selectedObject = findSelectedObject($projectionSimScene, selectedTarget);
  $: selectedProjector = findSelectedProjector($projectionSimScene, selectedTarget);
  $: selectedLocked = multiSelectionCount > 1
    ? selectedTargetList.every((target) => isProjectionSimTargetLocked($projectionSimScene, target))
    : isProjectionSimTargetLocked($projectionSimScene, selectedTarget);
  $: selectedPreset = PROJECTION_SIM_PRESETS.find((preset) => preset.id === selectedPresetId) ?? PROJECTION_SIM_PRESETS[0];
  $: canCopySceneItem = Boolean(selectedObject || selectedProjector);
  $: canPasteSceneItem = Boolean(sceneClipboard);
  $: {
    $projectionSimHistoryVersion;
    const historyCounts = projectionSimScene.getHistoryCounts();
    canUndoScene = historyCounts.past > 0;
    canRedoScene = historyCounts.future > 0;
  }

  function cloneSceneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function buildReferenceScene(id: string): ProjectionSimScene | null {
    if (id === BLANK_PRESET_ID) return createProjectionSimScene();
    if (!id) return null;
    return buildProjectionSimPreset(id);
  }

  function getSceneAdditions(scene: ProjectionSimScene, referenceId: string,
  ): {
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

  const defaultProjectionNameKeys: Record<string, string> = {
    'Projection Simulator': 'projection.simulator.defaultNames.projectionSimulator',
    'Isometric Cube Pyramid': 'projection.simulator.presets.names.cubePyramid',
    'Museum Facade': 'projection.simulator.presets.names.museumFacade',
    'Fragmented Cube Wall': 'projection.simulator.presets.names.isamCubes',
    'Center Projector': 'projection.simulator.defaultNames.centerProjector',
    Box: 'projection.simulator.build.primitives.box',
    Sphere: 'projection.simulator.build.primitives.sphere',
    Cylinder: 'projection.simulator.build.primitives.cylinder',
    Cone: 'projection.simulator.build.primitives.cone',
    Pyramid: 'projection.simulator.build.primitives.pyramid',
    Column: 'projection.simulator.build.primitives.column',
    Plane: 'projection.simulator.build.primitives.plane',
    'Rear limestone wall': 'projection.simulator.defaultNames.rearLimestoneWall',
    'Left facade wing': 'projection.simulator.defaultNames.leftFacadeWing',
    'Right facade wing': 'projection.simulator.defaultNames.rightFacadeWing',
    'Main entablature': 'projection.simulator.defaultNames.mainEntablature',
    'Upper cornice lip': 'projection.simulator.defaultNames.upperCorniceLip',
    'Triangular pediment': 'projection.simulator.defaultNames.triangularPediment',
    'Pediment relief block': 'projection.simulator.defaultNames.pedimentReliefBlock',
    'Ground plinth': 'projection.simulator.defaultNames.groundPlinth',
    'Lower step 1': 'projection.simulator.defaultNames.lowerStep1',
    'Lower step 2': 'projection.simulator.defaultNames.lowerStep2',
    'Central door recess': 'projection.simulator.defaultNames.centralDoorRecess',
    'Door lintel': 'projection.simulator.defaultNames.doorLintel',
    'Low stage base': 'projection.simulator.defaultNames.lowStageBase',
    'Left upper bridge': 'projection.simulator.defaultNames.leftUpperBridge',
    'Center upper bridge': 'projection.simulator.defaultNames.centerUpperBridge',
    'Right tower cap': 'projection.simulator.defaultNames.rightTowerCap',
    'Left tower cap': 'projection.simulator.defaultNames.leftTowerCap',
    'Deep lower left pocket': 'projection.simulator.defaultNames.deepLowerLeftPocket',
    'Deep lower center pocket': 'projection.simulator.defaultNames.deepLowerCenterPocket',
    'Deep lower right pocket': 'projection.simulator.defaultNames.deepLowerRightPocket',
    'Central screen face': 'projection.simulator.defaultNames.centralScreenFace',
    'Central screen left edge': 'projection.simulator.defaultNames.centralScreenLeftEdge',
    'Central screen right edge': 'projection.simulator.defaultNames.centralScreenRightEdge',
    'Central screen top edge': 'projection.simulator.defaultNames.centralScreenTopEdge',
    'Central screen bottom edge': 'projection.simulator.defaultNames.centralScreenBottomEdge',
  };

  function projectionDisplayName(name: string): string {
    const copyMatch = /^(.*?)(?:\s+Copy|\s+복사본)$/.exec(name);
    if (copyMatch) {
      return `${projectionDisplayName(copyMatch[1])} ${$t('projection.simulator.copySuffix')}`;
    }
    const directKey = defaultProjectionNameKeys[name];
    if (directKey) return $t(directKey);

    const patterns: Array<[RegExp, string, string[]]> = [
      [/^Pyramid cube (\d+)$/, 'projection.simulator.defaultNames.pyramidCube', ['number']],
      [/^Projector (\d+)$/, 'projection.simulator.defaultNames.projector', ['number']],
      [/^Fluted column (\d+)$/, 'projection.simulator.defaultNames.flutedColumn', ['number']],
      [/^Column (\d+) vertical shadow groove$/, 'projection.simulator.defaultNames.columnShadowGroove', ['number']],
      [/^Column (\d+) base block$/, 'projection.simulator.defaultNames.columnBaseBlock', ['number']],
      [
        /^museum wing window (\d+)\.(\d+) recess$/,
        'projection.simulator.defaultNames.museumWindowRecess',
        ['row', 'column'],
      ],
      [
        /^museum wing window (\d+)\.(\d+) trim top$/,
        'projection.simulator.defaultNames.museumWindowTrimTop',
        ['row', 'column'],
      ],
      [
        /^museum wing window (\d+)\.(\d+) trim bottom$/,
        'projection.simulator.defaultNames.museumWindowTrimBottom',
        ['row', 'column'],
      ],
      [
        /^museum wing window (\d+)\.(\d+) mullion$/,
        'projection.simulator.defaultNames.museumWindowMullion',
        ['row', 'column'],
      ],
      [/^Fragment cube (\d+)\.(\d+)$/, 'projection.simulator.defaultNames.fragmentCube', ['row', 'column']],
    ];
    for (const [pattern, key, fields] of patterns) {
      const match = pattern.exec(name);
      if (!match) continue;
      const values = Object.fromEntries(fields.map((field, index) => [field, match[index + 1]]));
      return $t(key, { values });
    }
    return name;
  }

  function copyName(name: string): string {
    const suffix = $t('projection.simulator.copySuffix');
    return /\bcopy\b/i.test(name) || name.endsWith(' 복사본') || name.endsWith(` ${suffix}`)
      ? name : `${name} ${suffix}`;
  }

  function snapGuideLabel(guide: ProjectionSimSnapGuide): string {
    const axis = guide.axis.toUpperCase();
    if (guide.label === 'spaced-evenly') {
      return $t('projection.simulator.snap.spacedEvenly', { values: { axis } });
    }
    if (guide.kind === 'ground') {
      return $t('projection.simulator.snapGuides.floor', { values: { axis } });
    }
    if (guide.kind === 'touch') {
      return $t('projection.simulator.snapGuides.touch', { values: { axis } });
    }
    if (guide.kind === 'align') {
      const key = guide.label.includes('center') ? 'center' : 'edge';
      return $t(`projection.simulator.snapGuides.${key}`, { values: { axis } });
    }
    const value = guide.label.match(/(-?\d+(?:\.\d+)?)$/)?.[1] ?? '';
    const key = guide.label.includes('equal gap') ? 'equalGap' : 'gap';
    return $t(`projection.simulator.snapGuides.${key}`, { values: { axis, value } });
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

  function findSelectedProjector(scene: ProjectionSimScene, target: ProjectionSimSelection,
  ): ProjectionSimProjector | null {
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

  function handleTransform(target: ProjectionSimSelection, patch: Partial<ProjectionSimObject> & { target?: ProjectionSimVec3 },
  ) {
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
    showSnapGuides([{ axis, kind: 'spacing', label: 'spaced-evenly', delta: 0,
      },
    ]);
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
      ? confirm(
          $t('projection.simulator.messages.keepAdditions', {
            values: { preset: presetLabel(preset.id, 'names', preset.name) },
          }),
        )
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
    if (count > 0 && !confirm($t('projection.simulator.messages.blankConfirm'))) return;
    projectionSimScene.newScene();
    loadedPresetId = BLANK_PRESET_ID;
  }

  function syncProjectorsFromSlices() {
    const slices = get(settings).output.slices.filter((slice) => slice.enabled !== false);
    if (!slices.length) {
      alert($t('projection.simulator.messages.noSlices'));
      return;
    }
    const center = (slices.length - 1) / 2;
    const projectors = slices.map((slice, index) => {
      const p = makeProjectionSimProjector(slice.name || $t('projection.simulator.messages.defaultSliceName', { values: { index: index + 1 } }), [(index - center) * 5, 4.7, 9], [(index - center) * 2.4, 2.3, 0],
      );
      p.source = 'slice';
      p.sliceId = slice.id;
      p.crop = [slice.cropX, slice.cropY, slice.cropW, slice.cropH];
      p.edgeBlend = [slice.edgeBlendLeft ?? 0, slice.edgeBlendRight ?? 0, slice.edgeBlendTop ?? 0, slice.edgeBlendBottom ?? 0,
      ];
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
      alert($t('projection.simulator.messages.unsupportedImport'));
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
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
      receiveProjection: ext !== 'ply',
      assetUrl: runtimeUrl,
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
      if (!ok) alert($t('projection.simulator.messages.invalidDesign'));
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

  function startRecording() {
    if (recorderHandle || !canvas) return;
    const recordCanvas = renderer?.beginRecording(1920, 1080) ?? canvas;
    recordingDuration = 0;
    recorderHandle = startCanvasRecording({
      namePrefix: $t('projection.simulator.recordingName'),
      canvas: recordCanvas,
      onDurationUpdate: (seconds) => { recordingDuration = seconds; },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
        renderer?.endRecording();
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        renderer?.endRecording();
        alert(err.message || $t('projection.simulator.messages.recordingFailed'));
      },
    });
    isRecording = !!recorderHandle;
    if (!isRecording) renderer?.endRecording();
  }

  function stopRecording() {
    recorderHandle?.stop();
    recorderHandle = null;
    isRecording = false;
    renderer?.endRecording();
  }

  function tick() {
    renderer?.render($projectionSimScene, sourceCanvas, $settings.output.slices);
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

    if (nativeWindowMode && isDesktopApp) {
      invoke<{ ok?: boolean; fullScreen?: boolean }>('projection_sim_get_fullscreen')
        .then((result) => { nativeFullScreen = !!result.fullScreen; })
        .catch(() => { /* non-native fallback */ });
      removeNativeFullscreenListener = (window as any).electronAPI?.on?.(
        'projection-sim-fullscreen-changed',
        (payload: { fullScreen?: boolean }) => { nativeFullScreen = !!payload?.fullScreen; }) ?? null;
    }
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', handleKeydown);
    if (snapGuideTimer !== null) window.clearTimeout(snapGuideTimer);
    snapGuideTimer = null;
    removeNativeFullscreenListener?.();
    removeNativeFullscreenListener = null;
    recorderHandle?.stop();
    recorderHandle = null;
    renderer?.endRecording();
    renderer?.dispose();
    renderer = null;
  });

  $: renderer?.setGizmoMode($projectionSimGizmoMode);
  $: renderer?.setPickProjectors(editProjectors);
  $: renderer?.setSelection($selectedProjectionSimTarget);
  $: renderer?.setSelections([...$selectedProjectionSimTargets]);
</script>

<div class="projection-sim-root" bind:this={rootEl}>
  <canvas class="sim-canvas" bind:this={canvas}></canvas>

  {#if !panelsHidden}
    {#if snapGuides.length}
      <div class="snap-hud">
        {#each snapGuides as guide}
          <span>{snapGuideLabel(guide)}</span>
        {/each}
      </div>
    {/if}

    <header class="sim-topbar">
      <button class="icon-btn" onclick={close} aria-label={$t('projection.simulator.navigation.back')}
        title={$t('projection.simulator.navigation.backTitle')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <div class="brand">PROJECTION<b>SIM</b></div>

      <div class="toolbar-cluster primary-actions" aria-label={$t('projection.simulator.toolbar.sceneFiles')}>
        <button class="tbtn primary" onclick={newBlankScene} title={$t('projection.simulator.toolbar.newTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>
          <span>{$t('projection.simulator.toolbar.new')}</span>
        </button>
        <button class="tbtn primary" onclick={saveDesign} title={$t('projection.simulator.toolbar.saveTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
          <span>{$t('projection.simulator.toolbar.save')}</span>
        </button>
        <button class="tbtn primary" onclick={loadDesign} title={$t('projection.simulator.toolbar.loadTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2"/></svg>
          <span>{$t('projection.simulator.toolbar.load')}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-cluster edit-actions" aria-label={$t('projection.simulator.toolbar.editActions')}>
        <button class="tbtn" disabled={!canUndoScene} onclick={undoScene} title={$t('projection.simulator.toolbar.undo')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/></svg>
          <span>{$t('projection.simulator.toolbar.undo')}</span>
        </button>
        <button class="tbtn" disabled={!canRedoScene} onclick={redoScene} title={$t('projection.simulator.toolbar.redo')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a5 5 0 0 0 0 10h2"/></svg>
          <span>{$t('projection.simulator.toolbar.redo')}</span>
        </button>
        <button class="tbtn" disabled={!canCopySceneItem} onclick={copySelectedSceneItem} title={$t('projection.simulator.toolbar.copyTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
          <span>{$t('projection.simulator.toolbar.copy')}</span>
        </button>
        <button class="tbtn" disabled={!canPasteSceneItem} onclick={pasteSceneItem} title={$t('projection.simulator.toolbar.pasteTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M4 13h8"/><path d="M8 9v8"/></svg>
          <span>{$t('projection.simulator.toolbar.paste')}</span>
        </button>
        <button class="tbtn danger-mini" disabled={!multiSelectionCount || selectedLocked} onclick={deleteSelected} title={$t('projection.simulator.toolbar.deleteTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          <span>{$t('projection.simulator.toolbar.delete')}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="seg" role="tablist">
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'translate'} onclick={() => setGizmo('translate')} title={$t('projection.simulator.toolbar.moveTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2l3 3"/><path d="M12 2L9 5"/><path d="M12 22l3-3"/><path d="M12 22l-3-3"/><path d="M2 12l3-3"/><path d="M2 12l3 3"/><path d="M22 12l-3-3"/><path d="M22 12l-3 3"/></svg>
          <span>{$t('projection.simulator.toolbar.move')}</span>
        </button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'rotate'} onclick={() => setGizmo('rotate')} title={$t('projection.simulator.toolbar.rotateTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v7h-7"/></svg>
          <span>{$t('projection.simulator.toolbar.rotate')}</span>
        </button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'scale'} onclick={() => setGizmo('scale')} title={$t('projection.simulator.toolbar.scaleTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v6h6"/><path d="M20 10V4h-6"/><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M14 10l6-6"/><path d="M4 20l6-6"/></svg>
          <span>{$t('projection.simulator.toolbar.scale')}</span>
        </button>
      </div>

      <div class="toolbar-cluster view-actions" aria-label={$t('projection.simulator.toolbar.viewActions')}>
        <button class="tbtn" onclick={() => renderer?.frameCamera()} title={$t('projection.simulator.toolbar.frameTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>
          <span>{$t('projection.simulator.toolbar.frame')}</span>
        </button>
        <button class="tbtn" onclick={() => renderer?.topCamera()} title={$t('projection.simulator.toolbar.topTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 5-8 5-8-5z"/><path d="M4 13l8 5 8-5"/></svg>
          <span>{$t('projection.simulator.toolbar.top')}</span>
        </button>
        <button class="tbtn" class:on={snapEnabled} onclick={() => (snapEnabled = !snapEnabled)} title={$t('projection.simulator.toolbar.snapTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><path d="M6 7h4"/><path d="M14 7h4"/><path d="M6 21v-4"/><path d="M18 21v-4"/></svg>
          <span>{$t('projection.simulator.toolbar.snap')}</span>
        </button>
        <button class="tbtn" class:on={editProjectors} onclick={() => (editProjectors = !editProjectors)} title={$t('projection.simulator.toolbar.projectorSelectionTitle')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H4z"/><path d="M16 10l5-3v10l-5-3"/><path d="M7 12h3"/></svg>
          <span>{$t('projection.simulator.toolbar.projectors')}</span>
        </button>
        <button class="tbtn" onclick={syncProjectorsFromSlices} title={$t('projection.simulator.toolbar.syncTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10"/><path d="M10 3l4 4-4 4"/><path d="M20 17H10"/><path d="M14 13l-4 4 4 4"/></svg>
          <span>{$t('projection.simulator.toolbar.sync')}</span>
        </button>
        <button class="tbtn" onclick={toggleFullscreen} title={$t('projection.simulator.toolbar.fullscreenTitle')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>
          <span>{$t('projection.simulator.toolbar.fullscreen')}</span>
        </button>
      </div>

      <div class="spacer"></div>

      {#if isRecording}
        <button class="tbtn rec recording" onclick={stopRecording}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10"/></svg>
          <span>{$t('projection.simulator.toolbar.stopRecording', {
              values: { duration: formatRecordingDuration(recordingDuration) },
            })}</span>
        </button>
      {:else}
        <button class="tbtn rec" onclick={startRecording}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>
          <span>{$t('projection.simulator.toolbar.record')}</span>
        </button>
      {/if}
      <button class="tbtn" onclick={togglePanels} title={$t('projection.simulator.toolbar.hideTitle')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"/><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 8.3 4 10 8a16.7 16.7 0 0 1-2.1 3.4"/><path d="M6.6 6.6A15.4 15.4 0 0 0 2 12c1.7 4 5 8 10 8a10.8 10.8 0 0 0 4.1-.8"/></svg>
        <span>{$t('projection.simulator.toolbar.hide')}</span>
      </button>
    </header>

    <aside class="sim-left">
      <section>
        <h3>{$t('projection.simulator.presets.heading')}</h3>
        <div class="preset-picker">
          <label class="field mini">
            <span>{$t('projection.simulator.presets.structure')}</span>
            <select
              value={selectedPresetId}
              onpointerdown={(event) => event.stopPropagation()}
              onmousedown={(event) => event.stopPropagation()}
              onclick={(event) => event.stopPropagation()}
              onchange={handlePresetSelect}
            >
              {#each PROJECTION_SIM_PRESETS as preset}
                <option value={preset.id}>{presetLabel(preset.id, 'names', preset.name)}</option>
              {/each}
            </select>
          </label>
          <p class="empty">{selectedPreset? presetLabel(selectedPreset.id, 'descriptions', selectedPreset.description) : ''}</p>
          <button class="wide-btn" onclick={() => applyPreset(selectedPresetId)}>{$t('projection.simulator.presets.load')}</button>
        </div>
      </section>

      <section>
        <h3>{$t('projection.simulator.build.heading')}</h3>
        <div class="primitive-grid">
          {#each primitiveKinds as kind}
            <button class="add-btn" onclick={() => addPrimitive(kind)}>{primitiveLabel(kind)}</button>
          {/each}
        </div>
        <button class="wide-btn" onclick={addProjector}>{$t('projection.simulator.build.addProjector')}</button>
        <button class="wide-btn" onclick={triggerImport}>{$t('projection.simulator.build.importModel')}</button>
        <input bind:this={fileInput} type="file" accept=".glb,.gltf,.obj,.fbx,.ply" style="display:none" onchange={handleImportFile} />
        <input bind:this={designFileInput} type="file" accept=".json,.ghost-projection" style="display:none" onchange={handleDesignFile} />
      </section>

      <section>
        <h3>{$t('projection.simulator.arrange.heading')}</h3>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapEnabled} />
          <span>{$t('projection.simulator.arrange.snap')}</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapTouch} disabled={!snapEnabled} />
          <span>{$t('projection.simulator.arrange.touchEdges')}</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={snapEqualSpacing} disabled={!snapEnabled} />
          <span>{$t('projection.simulator.arrange.matchGaps')}</span>
        </label>
        <label class="field">
          <span>{$t('projection.simulator.arrange.snapDistance', { values: { distance: snapThreshold.toFixed(2) } })}</span>
          <input type="range" min="0.02" max="0.5" step="0.01" bind:value={snapThreshold} disabled={!snapEnabled} />
        </label>
        <div class="arrange-grid">
          <button class="add-btn" onclick={() => spaceEvenly('x')}>{$t('projection.simulator.arrange.space', { values: { axis: 'X' } })}</button>
          <button class="add-btn" onclick={() => spaceEvenly('y')}>{$t('projection.simulator.arrange.space', { values: { axis: 'Y' } })}</button>
          <button class="add-btn" onclick={() => spaceEvenly('z')}>{$t('projection.simulator.arrange.space', { values: { axis: 'Z' } })}</button>
        </div>
      </section>

      <section>
        <h3>{$t('projection.simulator.scene.heading')}</h3>
        <label class="field mini">
          <span>{$t('projection.simulator.scene.name')}</span>
          <input value={projectionDisplayName($projectionSimScene.name)} oninput={(e) => projectionSimScene.setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{$t('projection.simulator.scene.roomExposure', {
              values: { value: ($projectionSimScene.environment.roomExposure ?? 1.15).toFixed(2) },
            })}</span>
          <input type="range" min="0.25" max="2.4" step="0.05" value={$projectionSimScene.environment.roomExposure ?? 1.15} oninput={(e) => projectionSimScene.setEnvironment({ roomExposure: parseFloat((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="field">
          <span>{$t('projection.simulator.scene.surfaceStyle')}</span>
          <select value={$projectionSimScene.environment.surfaceStyle ?? 'light-gray'} onchange={(e) => projectionSimScene.setEnvironment({ surfaceStyle: (e.target as HTMLSelectElement).value as ProjectionSimScene['environment']['surfaceStyle'],
              })}>
            <option value="light-gray">{$t('projection.simulator.scene.lightGraySurface')}</option>
            <option value="white">{$t('projection.simulator.scene.whiteSurface')}</option>
            <option value="dark-gray">{$t('projection.simulator.scene.darkGraySurface')}</option>
            <option value="original">{$t('projection.simulator.scene.originalMaterials')}</option>
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" checked={$projectionSimScene.environment.shadows} onchange={(e) => projectionSimScene.setEnvironment({ shadows: (e.target as HTMLInputElement).checked })} />
          <span>{$t('projection.simulator.scene.projectorShadows')}</span>
        </label>
        <label class="field">
          <span>{$t('projection.simulator.scene.shadowStrength', {
              values: { percent: Math.round(($projectionSimScene.environment.shadowStrength ?? 1) * 100)},
            })}</span>
          <input type="range" min="0" max="1" step="0.01" value={$projectionSimScene.environment.shadowStrength ?? 1} oninput={(e) => projectionSimScene.setEnvironment({ shadowStrength: parseFloat((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="check-row">
          <input type="checkbox" checked={$projectionSimScene.environment.showGrid} onchange={(e) => projectionSimScene.setEnvironment({ showGrid: (e.target as HTMLInputElement).checked })} />
          <span>{$t('projection.simulator.scene.floorGrid')}</span>
        </label>
      </section>

      <section>
        <h3>{$t('projection.simulator.objects.heading')}</h3>
        <div class="tree">
          {#each $projectionSimScene.objects as object}
            {@const key = `object:${object.id}`}
            <div class="tree-item" class:selected={isSelectedTarget(key)} class:primary={$selectedProjectionSimTarget === key}>
              <button class="tree-row" onclick={(event) => selectFromEvent(event, key)} title={$t('projection.simulator.objects.selectionTitle')}
              >
                <span>{objectTypeLabel(object)}</span>
                <b>{projectionDisplayName(object.name)}</b>
              </button>
              <button
                class="tree-lock"
                class:locked={object.locked}
                onclick={(e) => toggleObjectLock(e, object.id)}
                aria-label={`${object.locked ? $t('projection.simulator.objects.unlock') : $t('projection.simulator.objects.lock')} ${projectionDisplayName(object.name)}`}
                title={object.locked ? $t('projection.simulator.objects.unlock')
                  : $t('projection.simulator.objects.lock')}
              >{object.locked ? $t('projection.simulator.objects.locked')
                  : $t('projection.simulator.objects.lock')}</button>
              <button class="tree-delete" disabled={object.locked} onclick={(e) => removeObjectFromList(e, object.id)} aria-label={$t('projection.simulator.objects.deleteAria', {
                  values: { name: projectionDisplayName(object.name) },
                })}>×</button>
            </div>
          {/each}
        </div>
      </section>

      <section>
        <h3>{$t('projection.simulator.projectors.heading')}</h3>
        <div class="tree">
          {#each $projectionSimScene.projectors as projector}
            {@const key = `projector:${projector.id}`}
            <div class="tree-item" class:selected={isSelectedTarget(key)} class:primary={$selectedProjectionSimTarget === key}>
              <button class="tree-row projector" onclick={(event) => selectFromEvent(event, key)} title={$t('projection.simulator.projectors.selectionTitle')}
              >
                <span>{projectorSourceLabel(projector.source)}</span>
                <b>{projectionDisplayName(projector.name)}</b>
              </button>
              <button
                class="tree-lock"
                class:locked={projector.locked}
                onclick={(e) => toggleProjectorLock(e, projector.id)}
                aria-label={`${projector.locked ? $t('projection.simulator.projectors.unlock') : $t('projection.simulator.projectors.lock')} ${projectionDisplayName(projector.name)}`}
                title={projector.locked ? $t('projection.simulator.projectors.unlock')
                  : $t('projection.simulator.projectors.lock')}
              >{projector.locked ? $t('projection.simulator.projectors.locked')
                  : $t('projection.simulator.projectors.lock')}</button>
              <button class="tree-delete" disabled={projector.locked} onclick={(e) => removeProjectorFromList(e, projector.id)} aria-label={$t('projection.simulator.projectors.deleteAria', {
                  values: { name: projectionDisplayName(projector.name) },
                })}>×</button>
            </div>
          {/each}
        </div>
      </section>
    </aside>

    <aside class="sim-right">
      {#if multiSelectionCount > 1}
        <section>
          <h3>{$t('projection.simulator.selection.count', { values: { count: multiSelectionCount} })}</h3>
          <p class="empty">{$t('projection.simulator.selection.hint')}</p>
          <button class="danger wide-btn" disabled={selectedLocked} onclick={deleteSelected}>{$t('projection.simulator.selection.delete')}</button>
        </section>
      {:else if selectedObject}
        <section>
          <h3>{projectionDisplayName(selectedObject.name)}</h3>
          <label class="field">
            <span>{$t('projection.simulator.objectInspector.name')}</span>
            <input value={projectionDisplayName(selectedObject.name)} oninput={(e) => updateObject(selectedObject.id, { name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.locked} onchange={() => projectionSimScene.toggleObjectLock(selectedObject!.id)} />
            <span>{$t('projection.simulator.objectInspector.locked')}</span>
          </label>
          <div class="triple">
            <label>{$t('projection.simulator.objectInspector.positionX')}<input type="number" step="0.1" value={selectedObject.position[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisY')}<input type="number" step="0.1" value={selectedObject.position[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisZ')}<input type="number" step="0.1" value={selectedObject.position[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'position', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>{$t('projection.simulator.objectInspector.scaleX')}<input type="number" step="0.1" value={selectedObject.scale[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisY')}<input type="number" step="0.1" value={selectedObject.scale[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisZ')}<input type="number" step="0.1" value={selectedObject.scale[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'scale', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>{$t('projection.simulator.objectInspector.rotationX')}<input type="number" step="0.05" value={selectedObject.rotation[0]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisY')}<input type="number" step="0.05" value={selectedObject.rotation[1]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.objectInspector.axisZ')}<input type="number" step="0.05" value={selectedObject.rotation[2]} disabled={selectedObject.locked} oninput={(e) => updateObjectVec(selectedObject.id, 'rotation', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>{$t('projection.simulator.objectInspector.surfaceColor')}</span>
            <input type="color" value={selectedObject.color} oninput={(e) => updateObject(selectedObject.id, { color: (e.target as HTMLInputElement).value })} />
          </label>
          {#if selectedObject.type === 'pointcloud'}
            <label class="field">
              <span>{$t('projection.simulator.objectInspector.pointSize')}</span>
              <input type="range" min="0.005" max="0.12" step="0.005" value={selectedObject.pointSize ?? 0.035} oninput={(e) => updateObject(selectedObject.id, { pointSize: parseFloat((e.target as HTMLInputElement).value) })} />
            </label>
          {/if}
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.receiveProjection} disabled={selectedObject.type === 'pointcloud'} onchange={(e) => updateObject(selectedObject.id, { receiveProjection: (e.target as HTMLInputElement).checked })} />
            <span>{$t('projection.simulator.objectInspector.receiveProjection')}</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.visible} onchange={(e) => updateObject(selectedObject.id, { visible: (e.target as HTMLInputElement).checked })} />
            <span>{$t('projection.simulator.objectInspector.visible')}</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedObject.castShadow} onchange={(e) => updateObject(selectedObject.id, { castShadow: (e.target as HTMLInputElement).checked })} />
            <span>{$t('projection.simulator.objectInspector.castShadow')}</span>
          </label>
          <button class="danger wide-btn" disabled={selectedObject.locked} onclick={() => projectionSimScene.removeObject(selectedObject!.id)}>{$t('projection.simulator.objectInspector.delete')}</button>
        </section>
      {:else if selectedProjector}
        <section>
          <h3>{projectionDisplayName(selectedProjector.name)}</h3>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.name')}</span>
            <input value={projectionDisplayName(selectedProjector.name)} oninput={(e) => updateProjector(selectedProjector.id, { name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.locked} onchange={() => projectionSimScene.toggleProjectorLock(selectedProjector!.id)} />
            <span>{$t('projection.simulator.projectorInspector.locked')}</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.enabled} onchange={(e) => updateProjector(selectedProjector.id, { enabled: (e.target as HTMLInputElement).checked })} />
            <span>{$t('projection.simulator.projectorInspector.enabled')}</span>
          </label>
          <label class="check-row">
            <input type="checkbox" checked={selectedProjector.showFrustum} onchange={(e) => updateProjector(selectedProjector.id, { showFrustum: (e.target as HTMLInputElement).checked })} />
            <span>{$t('projection.simulator.projectorInspector.showBeam')}</span>
          </label>
          <div class="triple">
            <label>{$t('projection.simulator.projectorInspector.positionX')}<input type="number" step="0.1" value={selectedProjector.position[0]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.axisY')}<input type="number" step="0.1" value={selectedProjector.position[1]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.axisZ')}<input type="number" step="0.1" value={selectedProjector.position[2]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'position', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="triple">
            <label>{$t('projection.simulator.projectorInspector.targetX')}<input type="number" step="0.1" value={selectedProjector.target[0]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.axisY')}<input type="number" step="0.1" value={selectedProjector.target[1]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.axisZ')}<input type="number" step="0.1" value={selectedProjector.target[2]} disabled={selectedProjector.locked} oninput={(e) => updateProjectorVec(selectedProjector.id, 'target', 2, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.fov', {
                values: { value: Math.round(selectedProjector.fov)},
              })}</span>
            <input type="range" min="12" max="80" step="1" value={selectedProjector.fov} disabled={selectedProjector.locked} oninput={(e) => updateProjector(selectedProjector.id, { fov: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.intensity', {
                values: { value: selectedProjector.intensity.toFixed(1) },
              })}</span>
            <input type="range" min="0" max="20" step="0.1" value={selectedProjector.intensity} oninput={(e) => updateProjector(selectedProjector.id, { intensity: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.opacity', {
                values: { percent: Math.round(selectedProjector.opacity * 100)},
              })}</span>
            <input type="range" min="0" max="1" step="0.01" value={selectedProjector.opacity} oninput={(e) => updateProjector(selectedProjector.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.source')}</span>
            <select value={selectedProjector.source} onchange={(e) => updateProjector(selectedProjector.id, { source: (e.target as HTMLSelectElement).value as 'master' | 'slice',
                })}>
              <option value="master">{$t('projection.simulator.projectorInspector.masterCanvas')}</option>
              <option value="slice">{$t('projection.simulator.projectorInspector.outputSlice')}</option>
            </select>
          </label>
          {#if selectedProjector.source === 'slice'}
            <label class="field">
              <span>{$t('projection.simulator.projectorInspector.slice')}</span>
              <select value={selectedProjector.sliceId ?? ''} onchange={(e) => updateProjector(selectedProjector.id, { sliceId: (e.target as HTMLSelectElement).value || null })}>
                <option value="">{$t('projection.simulator.projectorInspector.manualCrop')}</option>
                {#each $settings.output.slices as slice}
                  <option value={slice.id}>{slice.name}</option>
                {/each}
              </select>
            </label>
          {/if}
          <div class="quad">
            <label>{$t('projection.simulator.projectorInspector.cropX')}<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[0]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.axisY')}<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[1]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.width')}<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[2]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 2, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.height')}<input type="number" min="0" max="1" step="0.01" value={selectedProjector.crop[3]} oninput={(e) => updateProjectorCrop(selectedProjector.id, 3, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="quad">
            <label>{$t('projection.simulator.projectorInspector.blendLeft')}<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[0]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 0, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.blendRight')}<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[1]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 1, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.blendTop')}<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[2]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 2, (e.target as HTMLInputElement).value)} /></label>
            <label>{$t('projection.simulator.projectorInspector.blendBottom')}<input type="number" min="0" max="0.5" step="0.01" value={selectedProjector.edgeBlend[3]} oninput={(e) => updateProjectorBlend(selectedProjector.id, 3, (e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field">
            <span>{$t('projection.simulator.projectorInspector.tint')}</span>
            <input type="color" value={selectedProjector.color} oninput={(e) => updateProjector(selectedProjector.id, { color: (e.target as HTMLInputElement).value })} />
          </label>
          <button class="danger wide-btn" disabled={selectedProjector.locked} onclick={() => projectionSimScene.removeProjector(selectedProjector!.id)}>{$t('projection.simulator.projectorInspector.delete')}</button>
        </section>
      {:else}
        <section>
          <h3>{$t('projection.simulator.empty.title')}</h3>
          <p class="empty">{$t('projection.simulator.empty.description')}</p>
        </section>
      {/if}
    </aside>
  {:else}
    <button class="show-panels" onclick={togglePanels}>{$t('projection.simulator.toolbar.showControls')}</button>
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
    border: 1px solid rgba(255,255,255, 0.1);
    background: rgba(255,255,255,0.025);
    flex: 0 0 auto;
  }
  .toolbar-cluster.primary-actions {
    border-color: rgba(97, 214, 164, 0.18);
    background: linear-gradient(180deg, rgba(97, 214, 164, 0.075), rgba(255,255,255,0.02));
  }
  .toolbar-cluster.edit-actions {
    border-color: rgba(91, 141, 239, 0.2);
    background: linear-gradient(180deg, rgba(91, 141, 239, 0.065), rgba(255,255,255,0.02));
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
    border-color: rgba(97, 214, 164, 0.3);
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
  .field input[type='color'] {
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
</style>
