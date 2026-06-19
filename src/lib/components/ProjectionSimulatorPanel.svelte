<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { settings, type OutputSlice } from '../stores/settings';
  import { workspace } from '../stores/workspace';
  import { invoke, isDesktopApp } from '../bridge';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import { startRecording as startCanvasRecording, formatRecordingDuration, type RecorderHandle } from '../recording/recorder';
  import { ProjectionSimulatorRenderer } from '../projectionSim/ProjectionSimulatorRenderer';
  import {
    isProjectionSimTargetLocked,
    projectionSimGizmoMode,
    projectionSimScene,
    selectedProjectionSimTarget,
  } from '../projectionSim/store';
  import {
    makeProjectionSimProjector,
    type ProjectionSimObject,
    type ProjectionSimPrimitiveKind,
    type ProjectionSimProjector,
    type ProjectionSimScene,
    type ProjectionSimSelection,
    type ProjectionSimVec3,
  } from '../projectionSim/types';
  import { PROJECTION_SIM_PRESETS } from '../projectionSim/presets';
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
  let editProjectors = false;
  let snapEnabled = true;
  let snapTouch = true;
  let snapEqualSpacing = true;
  let snapThreshold = 0.12;
  let snapGuides: ProjectionSimSnapGuide[] = [];
  let snapGuideTimer: number | null = null;
  let sceneClipboard: { kind: 'object'; object: ProjectionSimObject } | { kind: 'projector'; projector: ProjectionSimProjector } | null = null;

  const primitiveKinds: ProjectionSimPrimitiveKind[] = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'column', 'plane'];

  $: selectedTarget = $selectedProjectionSimTarget;
  $: selectedObject = findSelectedObject($projectionSimScene, selectedTarget);
  $: selectedProjector = findSelectedProjector($projectionSimScene, selectedTarget);
  $: selectedLocked = isProjectionSimTargetLocked($projectionSimScene, selectedTarget);
  $: selectedPreset = PROJECTION_SIM_PRESETS.find((preset) => preset.id === selectedPresetId) ?? PROJECTION_SIM_PRESETS[0];
  $: canCopySceneItem = Boolean(selectedObject || selectedProjector);
  $: canPasteSceneItem = Boolean(sceneClipboard);

  function cloneSceneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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

  function select(target: ProjectionSimSelection) {
    selectedProjectionSimTarget.set(target);
    renderer?.setSelection(target);
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
    const target = get(selectedProjectionSimTarget);
    if (!target) return;
    if (isProjectionSimTargetLocked(get(projectionSimScene), target)) return;
    const [kind, id] = target.split(':') as ['object' | 'projector', string];
    if (kind === 'object') projectionSimScene.removeObject(id);
    else projectionSimScene.removeProjector(id);
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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelectedSceneItem();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteSceneItem();
    } else if (event.key === 'Escape') {
      selectedProjectionSimTarget.set(null);
    }
  }

  function applyPreset(id: string) {
    const count = $projectionSimScene.objects.length + $projectionSimScene.projectors.length;
    if (count > 0 && !confirm('Replace the current simulator scene?')) return;
    projectionSimScene.loadPreset(id);
  }

  function newBlankScene() {
    const count = $projectionSimScene.objects.length + $projectionSimScene.projectors.length;
    if (count > 0 && !confirm('Start a blank projection simulator scene?')) return;
    projectionSimScene.newScene();
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
      if (!ok) alert('That file is not a valid Ghost projection simulator scene.');
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
    recordingDuration = 0;
    recorderHandle = startCanvasRecording({
      namePrefix: 'Projection Simulator',
      canvas,
      onDurationUpdate: (seconds) => { recordingDuration = seconds; },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        alert(err.message || 'Projection simulator recording failed');
      },
    });
    isRecording = !!recorderHandle;
  }

  function stopRecording() {
    recorderHandle?.stop();
    recorderHandle = null;
    isRecording = false;
  }

  function tick() {
    renderer?.render($projectionSimScene, sourceCanvas, $settings.output.slices);
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    renderer = new ProjectionSimulatorRenderer(canvas, {
      onSelect: select,
      onTransform: handleTransform,
    });
    renderer.setGizmoMode($projectionSimGizmoMode);
    renderer.setPickProjectors(editProjectors);
    renderer.setSelection($selectedProjectionSimTarget);
    raf = requestAnimationFrame(tick);

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
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', handleKeydown);
    if (snapGuideTimer !== null) window.clearTimeout(snapGuideTimer);
    snapGuideTimer = null;
    removeNativeFullscreenListener?.();
    removeNativeFullscreenListener = null;
    recorderHandle?.stop();
    recorderHandle = null;
    renderer?.dispose();
    renderer = null;
  });

  $: renderer?.setGizmoMode($projectionSimGizmoMode);
  $: renderer?.setPickProjectors(editProjectors);
  $: renderer?.setSelection($selectedProjectionSimTarget);
</script>

<div class="projection-sim-root" bind:this={rootEl}>
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

      <div class="seg" role="tablist">
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'translate'} onclick={() => setGizmo('translate')}>Move</button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'rotate'} onclick={() => setGizmo('rotate')}>Rotate</button>
        <button class="seg-btn" class:on={$projectionSimGizmoMode === 'scale'} onclick={() => setGizmo('scale')}>Scale</button>
      </div>

      <button class="tbtn" onclick={() => renderer?.frameCamera()}>Frame</button>
      <button class="tbtn" onclick={() => renderer?.topCamera()}>Top</button>
      <button class="tbtn" onclick={newBlankScene}>New</button>
      <button class="tbtn" class:on={snapEnabled} onclick={() => snapEnabled = !snapEnabled}>Snap</button>
      <button class="tbtn" class:on={editProjectors} onclick={() => editProjectors = !editProjectors}>Edit Projectors</button>
      <button class="tbtn" disabled={!canCopySceneItem} onclick={copySelectedSceneItem}>Copy</button>
      <button class="tbtn" disabled={!canPasteSceneItem} onclick={pasteSceneItem}>Paste</button>
      <button class="tbtn danger-mini" disabled={!$selectedProjectionSimTarget || selectedLocked} onclick={deleteSelected}>Delete</button>
      <button class="tbtn" onclick={syncProjectorsFromSlices}>Sync Slices</button>
      <button class="tbtn" onclick={toggleFullscreen}>Full Screen</button>
      <button class="tbtn" onclick={saveDesign}>Save</button>
      <button class="tbtn" onclick={loadDesign}>Load</button>

      <div class="spacer"></div>

      {#if isRecording}
        <button class="tbtn rec recording" onclick={stopRecording}>Stop {formatRecordingDuration(recordingDuration)}</button>
      {:else}
        <button class="tbtn rec" onclick={startRecording}>Rec</button>
      {/if}
      <button class="tbtn" onclick={togglePanels}>Hide</button>
    </header>

    <aside class="sim-left">
      <section>
        <h3>Presets</h3>
        <div class="preset-picker">
          <label class="field mini">
            <span>Structure</span>
            <select bind:value={selectedPresetId}>
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
            <div class="tree-item" class:selected={$selectedProjectionSimTarget === `object:${object.id}`}>
              <button class="tree-row" onclick={() => select(`object:${object.id}`)}>
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
            <div class="tree-item" class:selected={$selectedProjectionSimTarget === `projector:${projector.id}`}>
              <button class="tree-row projector" onclick={() => select(`projector:${projector.id}`)}>
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
      {#if selectedObject}
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
            <span>FOV {Math.round(selectedProjector.fov)}°</span>
            <input type="range" min="12" max="80" step="1" value={selectedProjector.fov} disabled={selectedProjector.locked} oninput={(e) => updateProjector(selectedProjector.id, { fov: parseFloat((e.target as HTMLInputElement).value) })} />
          </label>
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
  }
  .brand {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    letter-spacing: 0.08em;
    font-size: 13px;
    margin-right: 8px;
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
  .icon-btn {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
  }
  .tbtn {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
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
  }
  .seg-btn {
    height: 30px;
    border: 0;
    border-right: 1px solid rgba(255,255,255,0.1);
    padding: 0 10px;
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 13px;
    font-weight: 650;
  }
  .tree-row span,
  .empty {
    font-size: 11px;
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
  .tree-delete {
    min-height: 40px;
    color: #ffaaa0;
  }
  .tree-lock {
    min-height: 40px;
    padding: 0 6px;
    font-size: 10px;
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
    font-size: 12px;
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
    font-size: 11px;
    color: var(--ga-ink-2, #9ca3af);
  }
  .show-panels {
    top: 16px;
    right: 16px;
    height: 34px;
    padding: 0 14px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-size: 12px;
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
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    box-shadow: 0 10px 28px rgba(0,0,0,0.34);
  }
</style>
