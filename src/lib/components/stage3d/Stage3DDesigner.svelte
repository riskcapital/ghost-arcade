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
  import { ELEMENT_TYPES, makeUserElement } from '../../stage3d/elementTypes';
  import { buildVenue, paPresetElements, type PAPreset } from '../../stage3d/venues';
  import type { Stage3DVenue, UserStageElement } from '../../stage3d/types';
  import {
    startRecording as startCanvasRecording,
    formatRecordingDuration,
    type RecorderHandle,
  } from '../../recording/recorder';
  import { invoke, isDesktopApp } from '../../bridge';
  import { t } from '../../i18n';
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
    '4k': { w: 3840, h: 2160, label: '4K' },
  } as const;
  let recRes: keyof typeof REC_RES = '1080';

  // Refresh undo/redo button state whenever historyVersion bumps.
  let canUndo = false;
  let canRedo = false;
  $: {
    void $historyVersion;
    const c = stage3dScene.getHistoryCounts();
    canUndo = c.past > 0;
    canRedo = c.future > 0;
  }

  $: screenLayers = $project.layers.filter((l) => l.type === 'screen' && l.visible !== false);
  $: userElements = $stage3dScene.userElements ?? [];
  $: venue = ($stage3dScene.venue ?? 'festival') as Stage3DVenue;
  // Venue scenery pieces (deck, trusses, movers, PA…) the renderer
  // discovered for the current venue, plus their per-piece override so
  // the tree can show deleted/moved state and offer restore.
  $: sceneryItems = $stage3DSceneryList;
  $: sceneryOverrides = $stage3dScene.sceneryOverrides ?? {};

  const venueTranslationKeys: Record<Stage3DVenue, string> = {
    festival: 'stage3d.venues.festival',
    arena: 'stage3d.venues.arena',
    club: 'stage3d.venues.club',
    nightclub: 'stage3d.venues.nightclub',
    sphere: 'stage3d.venues.sphere',
  };
  const sceneryWordTranslationKeys: Record<string, string> = {
    backdrop: 'stage3d.scenery.words.backdrop',
    deck: 'stage3d.scenery.words.deck',
    riser: 'stage3d.scenery.words.riser',
    truss: 'stage3d.scenery.words.truss',
    front: 'stage3d.scenery.words.front',
    back: 'stage3d.scenery.words.back',
    mid: 'stage3d.scenery.words.mid',
    tower: 'stage3d.scenery.words.tower',
    beam: 'stage3d.scenery.words.beam',
    mover: 'stage3d.scenery.words.mover',
    side: 'stage3d.scenery.words.side',
    stage: 'stage3d.scenery.words.stage',
    floor: 'stage3d.scenery.words.floor',
    par: 'stage3d.scenery.words.par',
    pa: 'stage3d.scenery.words.pa',
    bar: 'stage3d.scenery.words.bar',
    mezzanine: 'stage3d.scenery.words.mezzanine',
    booth: 'stage3d.scenery.words.booth',
    mirror: 'stage3d.scenery.words.mirror',
    ball: 'stage3d.scenery.words.ball',
    dj: 'stage3d.scenery.words.dj',
    led: 'stage3d.scenery.words.led',
    wall: 'stage3d.scenery.words.wall',
    sub: 'stage3d.scenery.words.sub',
    speaker: 'stage3d.scenery.words.speaker',
    array: 'stage3d.scenery.words.array',
    stack: 'stage3d.scenery.words.stack',
  };

  function venueLabel(value: Stage3DVenue): string {
    return $t(venueTranslationKeys[value]);
  }

  function elementLabel(type: string, fallback: string): string {
    const key = `stage3d.library.items.${type}`;
    const value = $t(key);
    return value === key ? fallback : value;
  }

  function sceneryLabel(item: { id: string; label: string }): string {
    const directKey = `stage3d.scenery.items.${item.id}`;
    const direct = $t(directKey);
    if (direct !== directKey) return direct;
    return item.label
      .split(' ')
      .map((part) => {
        const key = sceneryWordTranslationKeys[part.toLowerCase()];
        return key ? $t(key) : part;
      })
      .join(' ');
  }

  function deleteScenery(id: string) {
    stage3dScene.setSceneryOverride(id, { deleted: true });
    setStage3DSelection(null);
    toast($t('stage3d.toast.venueHidden'));
  }
  function restoreScenery(id: string) {
    // null clears the whole override → piece returns to baseline
    // transform AND visibility.
    stage3dScene.setSceneryOverride(id, null);
    toast($t('stage3d.toast.venueRestored'));
  }
  $: selection = parseSelection($selectedStage3DNodeId);
  $: selectedScreen = selection?.kind === 'screen' ? screenLayers.find((l) => l.id === selection!.id) : null;
  $: selectedElement = selection?.kind === 'element' ? userElements.find((e) => e.id === selection!.id) : null;
  $: selectedScenery =
    selection?.kind === 'scenery' ? (sceneryItems.find((s) => s.id === selection!.id) ?? null) : null;
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
    return (
      (scene.userElements?.length ?? 0) > 0 ||
      Object.keys(scene.sceneryOverrides ?? {}).length > 0 ||
      Object.keys(scene.screenOverrides ?? {}).length > 0
    );
  }

  function setVenue(v: Stage3DVenue) {
    const current = get(stage3dScene);
    const currentVenue = (current.venue ?? 'festival') as Stage3DVenue;
    if (v === currentVenue) return;

    const keepAdditions = hasStageAdditions(current)
      ? confirm($t('stage3d.dialogs.keepVenue', { values: { venue: venueLabel(v) } }))
      : false;

    if (keepAdditions) {
      stage3dScene.setVenue(v);
      toast($t('stage3d.toast.venueAdditionsKept', { values: { venue: venueLabel(v) } }));
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
    toast($t('stage3d.toast.venueClean', { values: { venue: venueLabel(v) } }));
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
    toast($t('stage3d.toast.elementAdded', { values: { label: elementLabel(type, def.label) } }));
  }

  function applyPAPreset(kind: PAPreset) {
    const venueBuild = buildVenue(venue);
    const elements = paPresetElements(kind, venueBuild);
    for (const el of elements) stage3dScene.addUserElement(el);
    toast($t('stage3d.toast.paPresetAdded'));
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
    if (confirm($t('stage3d.dialogs.clearElements', { values: { count: userElements.length } }))) {
      stage3dScene.clearUserElements();
      setStage3DSelection(null);
      toast($t('stage3d.toast.cleared'));
    }
  }

  /** Save the whole Ghost Stage design — 3D scene PLUS the project's
   *  screen layers + surface slices so loading the file later restores
   *  both the 3D viewport AND the matching 2D mapper layout. Other
   *  project layers (videos, shaders, etc.) are left out so loading a
   *  stage into a different project doesn't blow away unrelated work. */
  function saveDesign() {
    const proj = $project;
    const screenLayers = proj.layers.filter((l) => l.type === 'screen');
    const bundle = {
      format: 'ghost-stage',
      version: 1,
      name: proj.name ?? $t('stage3d.file.untitledStage'),
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
    a.download = `${(proj.name || $t('stage3d.file.defaultFilename')).replace(/[^a-z0-9-_ ]/gi, '_')}.ghost-stage.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast($t('stage3d.toast.stageSaved'));
  }

  let fileInput: HTMLInputElement;
  function loadDesign() { fileInput?.click(); }
  function onFileChosen(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = rd.result as string;
      const ok = applyStageBundle(text);
      toast($t(ok ? 'stage3d.toast.stageLoaded' : 'stage3d.toast.invalidFile'));
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
          project.update((p) => ({
            ...p,
            // Replace screens but keep every non-screen layer the user
            // already has (videos, shaders, lights, etc.).
            layers: [
              ...p.layers.filter((l) => l.type !== 'screen'),
              ...data.project.screenLayers],
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

  function toast(msg: string) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = ''), 1600);
  }

  function startStageRecording() {
    if (recorderHandle) return;
    const controls = $stage3DRendererControls;
    const res = REC_RES[recRes];
    // Render into a fixed 16:9 offscreen canvas (decoupled from the
    // project's output resolution) and record THAT — so a wide comp
    // still produces a clean 1080p / 4K file.
    const recordCanvas = controls?.beginRecording(res.w, res.h) ?? null;
    if (!recordCanvas) {
      toast($t('stage3d.toast.stageRendererNotReady'));
      return;
    }
    recordingDuration = 0;
    recorderHandle = startCanvasRecording({
      namePrefix: $t('stage3d.file.recordingName'),
      canvas: recordCanvas,
      onDurationUpdate: (s) => {
        recordingDuration = s;
      },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
        controls?.endRecording();
        toast($t('stage3d.toast.recordingSaved'));
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        controls?.endRecording();
        toast(err.message || $t('stage3d.errors.recordingFailed'));
      },
    });
    if (recorderHandle) {
      isRecording = true;
      toast($t('stage3d.toast.recordingStarted', { values: { resolution: res.label } }));
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
    else startStageRecording();
  }

  // Library grouped by category.
  $: libraryGroups = (() => {
    const groups: Record<string, [string, (typeof ELEMENT_TYPES)[string]][]> = {};
    for (const [type, def] of Object.entries(ELEMENT_TYPES)) {
      (groups[def.group] = groups[def.group] || []).push([type, def]);
    }
    return ['Stage', 'Lighting', 'Audio'].map((g) => ({
      name: $t(`stage3d.library.groups.${g.toLowerCase()}`),
      items: groups[g] ?? [],
    }));
  })();

  function undo() {
    stage3dScene.undo();
  }
  function redo() {
    stage3dScene.redo();
  }
  function togglePanels() {
    panelsHidden = !panelsHidden;
  }

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
          const result = await invoke<{ ok?: boolean; fullScreen?: boolean }>('stage3d_set_fullscreen', {
            fullScreen: next,
          });
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
          if (!target?.requestFullscreen) throw new Error($t('stage3d.errors.fullscreenUnavailable'));
          await target.requestFullscreen();
          syncStageFullscreen(!!document.fullscreenElement);
        } else if (document.fullscreenElement) {
          await document.exitFullscreen();
          syncStageFullscreen(false);
        } else {
          syncStageFullscreen(false);
        }
      }

      toast(next ? $t('stage3d.toast.fullscreen') : $t('stage3d.toast.exitedFullscreen'));
    } catch {
      if (next && !panelsWereHiddenBeforeFullscreen) panelsHidden = false;
      toast(next ? $t('stage3d.errors.fullscreenUnavailable') : $t('stage3d.errors.exitFullscreenFailed'));
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
    if (!sel.size) {
      toast($t('stage3d.toast.nothingToCopy'));
      return;
    }
    const elements = userElements;
    const copies: UserStageElement[] = [];
    for (const key of sel) {
      const s = parseSelection(key);
      if (s?.kind !== 'element') continue;
      const el = elements.find((e) => e.id === s.id);
      if (el) copies.push(JSON.parse(JSON.stringify(el)));
    }
    if (!copies.length) {
      toast($t('stage3d.toast.libraryOnlyCopy'));
      return;
    }
    elementClipboard = copies;
    toast(
      $t('stage3d.toast.copied', {
        values: { count: copies.length, suffix: copies.length === 1 ? '' : 's' },
      }),
    );
  }

  function pasteSelection() {
    if (!elementClipboard.length) {
      toast($t('stage3d.toast.clipboardEmpty'));
      return;
    }
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
    toast(
      $t('stage3d.toast.pasted', {
        values: { count: newIds.length, suffix: newIds.length === 1 ? '' : 's' },
      }),
    );
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
      },
      );
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
    recorderHandle?.stop();
    recorderHandle = null;
  });
</script>

<div class="stage3d-root" class:external={!renderViewport}>
  {#if renderViewport}
    <div class="viewport-fallback">
      <p>{$t('stage3d.viewport.fallback')}</p>
    </div>
  {/if}

  {#if !panelsHidden}
  <header class="topbar">
    <button class="icon-btn" onclick={onClose} aria-label={$t('stage3d.toolbar.backToEditor')}
        title={$t('stage3d.toolbar.backTitle')}
      >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="seg" role="tablist">
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'translate'}
        onclick={() => setGizmoMode('translate')}
        title={$t('stage3d.toolbar.gizmo.moveTitle')}>✛ {$t('stage3d.toolbar.gizmo.move')}</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'rotate'}
        onclick={() => setGizmoMode('rotate')}
        title={$t('stage3d.toolbar.gizmo.rotateTitle')}>⟳ {$t('stage3d.toolbar.gizmo.rotate')}</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'scale'}
        onclick={() => setGizmoMode('scale')}
        title={$t('stage3d.toolbar.gizmo.scaleTitle')}>⤢ {$t('stage3d.toolbar.gizmo.scale')}</button>
    </div>

    <button class="tbtn" onclick={toggleSnap}>⊞ {$t('stage3d.toolbar.snap', {
          values: { state: snapOn ? $t('stage3d.toolbar.snapOn') : $t('stage3d.toolbar.snapOff') },
        })}</button>

    <button class="tbtn" onclick={undo} disabled={!canUndo} title={$t('stage3d.toolbar.undoTitle')}
        >↶ {$t('stage3d.toolbar.undo')}</button>
    <button class="tbtn" onclick={redo} disabled={!canRedo} title={$t('stage3d.toolbar.redoTitle')}
        >↷ {$t('stage3d.toolbar.redo')}</button>

    <div class="spacer"></div>

    <label class="dim-label" for="stage3d-venue-select">{$t('stage3d.toolbar.venue')}</label>
    <select
      id="stage3d-venue-select"
      class="vsel"
      value={venue}
      onchange={(e) => setVenue((e.target as HTMLSelectElement).value as Stage3DVenue)}
    >
      <option value="festival">{$t('stage3d.venues.festival')}</option>
      <option value="arena">{$t('stage3d.venues.arena')}</option>
      <option value="club">{$t('stage3d.venues.club')}</option>
      <option value="nightclub">{$t('stage3d.venues.nightclub')}</option>
      <option value="sphere">{$t('stage3d.venues.sphere')}</option>
    </select>

    <label class="dim-label" for="stage3d-pa-select">{$t('stage3d.toolbar.pa')}</label>
    <select id="stage3d-pa-select" class="vsel" value="" onchange={onPASelect}>
      <option value="">{$t('stage3d.toolbar.paAddPreset')}</option>
      <option value="linearray">{$t('stage3d.paPresets.linearray')}</option>
      <option value="festivalpa">{$t('stage3d.paPresets.festivalpa')}</option>
      <option value="groundstack">{$t('stage3d.paPresets.groundstack')}</option>
      <option value="club">{$t('stage3d.paPresets.club')}</option>
      <option value="nightclub">{$t('stage3d.paPresets.nightclub')}</option>
    </select>

    <button class="tbtn" onclick={() => $stage3DRendererControls?.topCamera()}>⬓ {$t('stage3d.toolbar.top')}</button>
    <button class="tbtn" onclick={() => $stage3DRendererControls?.frameCamera()}>⊡ {$t('stage3d.toolbar.frame')}</button>
    <button class="tbtn" onclick={() => { $stage3DRendererControls?.reload(); toast($t('stage3d.toast.sceneReloaded')); }} title={$t('stage3d.toolbar.reloadTitle')}>⟳ {$t('stage3d.toolbar.reload')}</button>
    {#if !isRecording}
      <select
        class="vsel rec-res"
        value={recRes}
        onchange={(e) => (recRes = (e.target as HTMLSelectElement).value as keyof typeof REC_RES)}
        title={$t('stage3d.toolbar.recordingResolutionTitle')}
        >
        <option value="1080">1080p</option>
        <option value="4k">4K</option>
      </select>
    {/if}
    <button
      class="tbtn rec-btn"
      class:recording={isRecording}
      onclick={toggleStageRecording}
      title={isRecording ? $t('stage3d.toolbar.stopRecordingTitle')
          : $t('stage3d.toolbar.recordTitle', { values: { resolution: REC_RES[recRes].label } })}
    >
      {isRecording ? `■ ${formatRecordingDuration(recordingDuration)}` : `● ${$t('stage3d.toolbar.rec')}`}
    </button>
    <button
      class="tbtn"
      class:reel-on={reelOpen}
      onclick={() => { reelOpen = !reelOpen; }}
      title={$t('stage3d.toolbar.reelTitle')}>🎬 {$t('stage3d.toolbar.reel')}</button>
    <button class="tbtn" onclick={togglePanels} title={$t('stage3d.toolbar.hideTitle')}
        >▤ {$t('stage3d.toolbar.hide')}</button>
    <button class="tbtn" onclick={saveDesign}>↓ {$t('stage3d.toolbar.save')}</button>
    <button class="tbtn" onclick={loadDesign}>↑ {$t('stage3d.toolbar.load')}</button>
    <button class="tbtn danger" onclick={clearElements}>✕ {$t('stage3d.toolbar.clear')}</button>
    <input bind:this={fileInput} type="file" accept="application/json" style="display:none" onchange={onFileChosen} />
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
        title={stageFullscreen ? $t('stage3d.toolbar.exitFullscreenTitle') : $t('stage3d.toolbar.fullscreenTitle')}
      >
        {stageFullscreen ? $t('stage3d.toolbar.exitFullscreen') : $t('stage3d.toolbar.fullscreen')}
      </button>
    </div>
    <div class="hud-group" title={$t('stage3d.toolbar.cameraElevationTitle')}>
      <button class="hud-btn" onclick={() => $stage3DRendererControls?.nudgeElevation(1)} title={$t('stage3d.toolbar.cameraUpTitle')}>▲</button>
      <button class="hud-btn" onclick={() => $stage3DRendererControls?.nudgeElevation(-1)} title={$t('stage3d.toolbar.cameraDownTitle')}>▼</button>
    </div>
    <div class="hud-group fov-ctl" title={$t('stage3d.toolbar.fovTitle')}>
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
    <h3>{$t('stage3d.library.title')}</h3>
    {#each libraryGroups as group}
      <div class="grp">
        <div class="ghd">{group.name}</div>
        {#each group.items as [type, def]}
          <button class="additem" onclick={() => addElement(type)}>
            <span class="ic">{def.icon}</span>{elementLabel(type, def.label)}
          </button>
        {/each}
      </div>
    {/each}
    {#if screenLayers.length > 0}
      <div class="grp">
        <div class="ghd">
            {$t('stage3d.library.screensAuto')}
            <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(screenLayers.map((l) => `screen:${l.id}`))}
            title={$t('stage3d.library.selectAllScreens')}>{$t('stage3d.library.selectAll')}</button>
        </div>
        {#each screenLayers as layer (layer.id)}
          {@const key = `screen:${layer.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey ? toggleStage3DSelection(key)
              : setStage3DSelection(key))}
            title={$t('stage3d.library.shiftAdd')}
            >
            <span class="ic">▦</span>{layer.name}
          </button>
        {/each}
      </div>
    {/if}
    {#if userElements.length > 0}
      <div class="grp">
        <div class="ghd">
            {$t('stage3d.library.placed')}
            <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(userElements.map((el) => `element:${el.id}`))}
            title={$t('stage3d.library.selectAllPlaced')}>{$t('stage3d.library.selectAll')}</button>
        </div>
        {#each userElements as el (el.id)}
          {@const key = `element:${el.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey ? toggleStage3DSelection(key)
              : setStage3DSelection(key))}
            title={$t('stage3d.library.shiftAdd')}
            >
            <span class="ic">▤</span>{elementLabel(el.type, ELEMENT_TYPES[el.type]?.label ?? el.type)}
          </button>
        {/each}
      </div>
    {/if}
    {#if sceneryItems.length > 0}
      <div class="grp">
        <div class="ghd">
            {$t('stage3d.library.venue')}
            <button
            class="ghd-action"
            onclick={() => stage3dScene.clearSceneryOverrides()}
            title={$t('stage3d.library.restoreAll')}>{$t('stage3d.library.reset')}</button>
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
              onclick={(e) => (e.shiftKey || e.metaKey ? toggleStage3DSelection(key)
                : setStage3DSelection(key))}
              title={isDeleted ? $t('stage3d.library.hidden') : $t('stage3d.library.shiftAdd')}
            >
              <span class="ic">◇</span>{sceneryLabel(item)}
            </button>
            {#if isDeleted}
              <button class="scenery-act" onclick={() => restoreScenery(item.id)} title={$t('stage3d.library.restore')}>⟲</button>
            {:else}
              <button class="scenery-act danger" onclick={() => deleteScenery(item.id)} title={$t('stage3d.library.hideDelete')}>✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </aside>

  <aside class="props">
    <h3>{$t('stage3d.inspector.title')}</h3>
    {#if $selectedStage3DTargets.size > 1}
      <div class="multi-banner">
        <b>{$selectedStage3DTargets.size}</b>
          {$t('stage3d.inspector.multiSelected')}
          {$t('stage3d.inspector.multiPrimary', {
            values: {
              outline: selectedScreen || selectedElement ? $t('stage3d.inspector.primaryOutline') : '',
            },
          })}
        </div>
    {/if}
    {#if venue === 'sphere' && !selectedElement && !selectedScenery}
      <div class="inspector-tabs" role="tablist" aria-label={$t('stage3d.inspector.sphereAria')}>
        <button
          class="inspector-tab"
          class:active={sphereInspectorTab === 'screen'}
          disabled={!sphereScreenLayer}
          onclick={showSphereScreenInspector}
          role="tab"
          aria-selected={sphereInspectorTab === 'screen'}
        >{$t('stage3d.inspector.screenTab')}</button>
        <button
          class="inspector-tab"
          class:active={sphereInspectorTab === 'room'}
          onclick={showSphereRoomInspector}
          role="tab"
          aria-selected={sphereInspectorTab === 'room'}
        >{$t('stage3d.inspector.roomTab')}</button>
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
        <div class="scenery-title">{sceneryLabel(selectedScenery)}</div>
        <div class="scenery-sub">{$t('stage3d.inspector.scenerySub')}</div>
        <p class="scenery-note">
            {$t('stage3d.inspector.sceneryNote', { values: { w: 'W', e: 'E', s: 'S' } })}
          </p>
          <button class="scenery-del" onclick={() => deleteScenery(selectedScenery.id)}>
            ✕ {$t('stage3d.inspector.hideElement')}
          </button>
          <button class="scenery-restore" onclick={() => restoreScenery(selectedScenery.id)}>
            ⟲ {$t('stage3d.inspector.resetPosition')}
          </button>
        </div>
      {:else}
        <StageLightingPanel />
        <div class="empty">
          {$t('stage3d.inspector.emptyLineOne')}
          {$t('stage3d.inspector.emptyLineTwo')}
          {$t('stage3d.inspector.emptyLineThree')}
        </div>
      {/if}
    </aside>

    <div class="hud">
      <span
        >{$t('stage3d.hud.elementCount', {
          values: { count: userElements.length, suffix: userElements.length === 1 ? '' : 's' },
        })}</span
      >
      <span
        >{$t('stage3d.hud.screenCount', {
          values: { count: screenLayers.length, suffix: screenLayers.length === 1 ? '' : 's' },
        })}</span
      >
      {#if $selectedStage3DTargets.size > 1}
        <span class="multi-pill">{$t('stage3d.hud.selected', { values: { count: $selectedStage3DTargets.size } })}</span
        >
      {/if}
      <span><span class="kbd">⇧</span>{$t('stage3d.hud.multiClick')}</span>
      <span
        ><span class="kbd">W</span>
          <span class="kbd">E</span> <span class="kbd">S</span> {$t('stage3d.hud.tools')}</span
      >
      <span><span class="kbd">⌘C</span>/<span class="kbd">⌘V</span> {$t('stage3d.hud.copy')}</span>
      <span><span class="kbd">⌘Z</span> {$t('stage3d.hud.undo')}</span>
      <span><span class="kbd">D</span> {$t('stage3d.hud.duplicate')}</span>
      <span><span class="kbd">⌫</span> {$t('stage3d.hud.delete')}</span>
      <span><span class="kbd">H</span> {$t('stage3d.hud.hide')}</span>
    </div>
  {/if}

  {#if panelsHidden}
    {#if stageFullscreen}
      <button class="show-panels-btn fullscreen-exit-btn"
        onclick={toggleStageFullscreen}
        title={$t('stage3d.panels.exitFullscreenTitle')}>{$t('stage3d.panels.exitFullscreen')}</button
      >
    {:else}
      <button class="show-panels-btn" onclick={togglePanels} title={$t('stage3d.panels.showTitle')}
        >▦ {$t('stage3d.panels.show')}</button
      >
    {/if}
  {/if}

  {#if reelOpen}
    <div class="reel-host">
      <DemoReelPanel
        onClose={() => {
          reelOpen = false;
        }}
      />
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
    background: #0a0c10;
    z-index: 1000;
    overflow: hidden;
    color: #e9edf4;
    font-family:
      'Space Grotesk',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
  }
  .stage3d-root.external {
    background: transparent;
    pointer-events: none;
  }
  .stage3d-root.external :global(button),
  .stage3d-root.external :global(input),
  .stage3d-root.external :global(select),
  .stage3d-root.external .topbar,
  .stage3d-root.external .lib,
  .stage3d-root.external .props,
  .stage3d-root.external .hud,
  .stage3d-root.external .reel-host,
  .stage3d-root.external .toast {
    pointer-events: auto;
  }
  .reel-host {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 25;
  }
  .reel-host :global(.reel-panel) {
    pointer-events: auto;
  }
  .tbtn.reel-on {
    background: #3b2a63;
    border-color: #5b46a3;
  }
  .viewport-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 15px;
  }

  /* ── Top bar ────────────────────────────────────────────────── */
  .topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 54px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: linear-gradient(180deg, rgba(10, 12, 16, 0.92), rgba(10, 12, 16, 0.4));
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(20, 22, 30, 0.85);
    color: #fff;
    font-size: 21px;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: rgba(40, 44, 56, 0.95);
  }
  .seg {
    display: flex;
    gap: 2px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 9px;
    padding: 3px;
  }
  .seg-btn {
    font: inherit;
    font-size: 12px;
    color: #8a93a3;
    background: none;
    border: none;
    padding: 6px 9px;
    border-radius: 6px;
    cursor: pointer;
  }
  .seg-btn:hover {
    color: #e9edf4;
  }
  .seg-btn.on {
    background: #4af2ff;
    color: #04161a;
    font-weight: 600;
  }
  .tbtn {
    font: inherit;
    font-size: 12px;
    color: #e9edf4;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 7px 9px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tbtn:hover {
    border-color: #4af2ff;
    color: #4af2ff;
  }
  /* ── Camera HUD strip (under the topbar, clear of the inspector) ── */
  .viewport-hud {
    position: absolute;
    top: 76px;
    right: 322px;
    z-index: 19;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hud-group {
    display: inline-flex;
    align-items: center;
    height: 30px;
    background: rgba(10, 12, 16, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    backdrop-filter: blur(8px);
  }
  .hud-btn {
    font: inherit;
    font-size: 11px;
    color: #e9edf4;
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.07);
    padding: 7px 9px;
    cursor: pointer;
  }
  .hud-btn:last-child {
    border-right: none;
  }
  .hud-btn:hover {
    color: #4af2ff;
  }
  .hud-btn:disabled {
    opacity: 0.45;
    cursor: wait;
  }
  .fullscreen-ctl {
    overflow: hidden;
  }
  .fullscreen-toggle {
    min-width: 88px;
    border-right: none;
  }
  .fullscreen-toggle.on {
    background: rgba(74, 242, 255, 0.14);
    color: #4af2ff;
  }
  .fov-ctl {
    gap: 6px;
    padding: 0 10px;
  }
  .fov-ctl .fov-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.55);
  }
  .fov-ctl input[type='range'] {
    width: 84px;
    accent-color: #4af2ff;
  }
  .fov-ctl .fov-val {
    font-size: 11px;
    color: #4af2ff;
    font-variant-numeric: tabular-nums;
    min-width: 30px;
    text-align: right;
  }
  .tbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .tbtn:disabled:hover {
    border-color: rgba(255, 255, 255, 0.08);
    color: #e9edf4;
  }
  .tbtn.danger:hover {
    border-color: #ff5cb8;
    color: #ff5cb8;
  }
  .rec-res {
    padding: 6px 6px;
    font-size: 12px;
  }
  .rec-btn {
    min-width: 66px;
    text-align: center;
  }
  .rec-btn.recording {
    background: rgba(255, 68, 91, 0.18);
    border-color: rgba(255, 68, 91, 0.72);
    color: #ff8d9b;
    font-family: 'IBM Plex Mono', monospace;
    font-variant-numeric: tabular-nums;
  }
  .rec-btn.recording:hover {
    border-color: #ff445b;
    color: #ffd2d8;
  }
  .show-panels-btn {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 15;
    font: inherit;
    font-size: 13px;
    color: #e9edf4;
    background: rgba(16, 19, 26, 0.92);
    border: 1px solid #4af2ff;
    border-radius: 20px;
    padding: 8px 18px;
    cursor: pointer;
    pointer-events: auto;
    backdrop-filter: blur(10px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }
  .show-panels-btn:hover {
    background: rgba(74, 242, 255, 0.15);
  }
  .show-panels-btn.fullscreen-exit-btn {
    left: auto;
    right: 14px;
    transform: none;
    border-color: #ff5cb8;
    opacity: 0.42;
  }
  .show-panels-btn.fullscreen-exit-btn:hover {
    background: rgba(255, 92, 184, 0.13);
    opacity: 1;
  }
  .spacer {
    flex: 1 1 0;
    min-width: 0;
  }
  .dim-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #8a93a3;
    letter-spacing: 0.1em;
  }
  .vsel {
    min-width: 0;
    font: inherit;
    font-size: 12px;
    color: #e9edf4;
    background: #10131a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 7px 8px;
    cursor: pointer;
  }
  #stage3d-venue-select {
    width: clamp(145px, 12vw, 220px);
  }
  #stage3d-pa-select {
    width: clamp(140px, 11vw, 205px);
  }
  @media (max-width: 1900px) {
    .dim-label {
      display: none;
    }
    .topbar {
      gap: 5px;
    }
    .tbtn {
      padding-inline: 8px;
    }
    .seg-btn {
      padding-inline: 8px;
    }
    #stage3d-pa-select {
      width: 185px;
    }
    #stage3d-venue-select {
      width: 205px;
    }
  }
  @media (max-width: 1740px) {
    .tbtn.danger {
      display: none;
    }
    #stage3d-pa-select {
      width: 168px;
    }
    #stage3d-venue-select {
      width: 185px;
    }
  }
  @media (max-width: 1620px) {
    .tbtn {
      padding-inline: 7px;
      font-size: 11px;
    }
    .seg-btn {
      padding-inline: 7px;
      font-size: 11px;
    }
    .vsel {
      font-size: 11px;
      padding-inline: 7px;
    }
    #stage3d-pa-select {
      width: 150px;
    }
    #stage3d-venue-select {
      width: 168px;
    }
  }
  @media (max-width: 1500px) {
    .tbtn:nth-last-of-type(2) {
      display: none;
    } /* Load */
    #stage3d-pa-select {
      width: 138px;
    }
    #stage3d-venue-select {
      width: 154px;
    }
  }

  /* ── Library ────────────────────────────────────────────────── */
  .lib {
    position: absolute;
    top: 66px;
    left: 12px;
    bottom: 12px;
    width: 212px;
    z-index: 15;
    background: rgba(16, 19, 26, 0.86);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 14px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
  }
  .lib h3 {
    font-size: 11px;
    letter-spacing: 0.22em;
    color: #8a93a3;
    text-transform: uppercase;
    margin: 0 0 9px;
  }
  .grp {
    margin-bottom: 16px;
  }
  .ghd {
    font-size: 12px;
    letter-spacing: 0.14em;
    color: #4af2ff;
    text-transform: uppercase;
    margin-bottom: 7px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ghd::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #4af2ff;
  }
  .additem {
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 13.5px;
    color: #e9edf4;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 9px 11px;
    margin-bottom: 5px;
    cursor: pointer;
    transition: 0.14s;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .additem:hover {
    background: rgba(74, 242, 255, 0.08);
    border-color: rgba(74, 242, 255, 0.4);
    transform: translateX(2px);
  }
  .additem.screen.selected,
  .additem.screen.selected:hover {
    background: rgba(187, 134, 252, 0.16);
    border-color: rgba(187, 134, 252, 0.6);
  }
  .additem.screen.selected.primary,
  .additem.screen.selected.primary:hover {
    background: rgba(74, 242, 255, 0.18);
    border-color: #4af2ff;
  }
  .additem .ic {
    width: 16px;
    text-align: center;
    opacity: 0.8;
  }

  /* ── Venue element rows (scenery) ─────────────────────────────── */
  .scenery-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 5px;
  }
  .scenery-row .scenery-pick {
    margin-bottom: 0;
    flex: 1;
    min-width: 0;
  }
  .scenery-pick :global(span) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .scenery-pick.deleted {
    opacity: 0.4;
    text-decoration: line-through;
    cursor: default;
  }
  .scenery-pick.deleted:hover {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.08);
    transform: none;
  }
  .scenery-act {
    flex: 0 0 auto;
    width: 26px;
    height: 34px;
    font: inherit;
    font-size: 13px;
    color: #8a93a3;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    cursor: pointer;
  }
  .scenery-act:hover {
    color: #4af2ff;
    border-color: #4af2ff;
  }
  .scenery-act.danger:hover {
    color: #ff5cb8;
    border-color: #ff5cb8;
  }

  /* ── Venue element inspector ──────────────────────────────────── */
  .scenery-inspect {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .scenery-title {
    font-size: 16px;
    font-weight: 600;
    color: #e9edf4;
  }
  .scenery-sub {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #4af2ff;
  }
  .scenery-note {
    color: #8a93a3;
    font-size: 13px;
    line-height: 1.6;
    margin: 4px 0 8px;
  }
  .scenery-del,
  .scenery-restore {
    font: inherit;
    font-size: 13.5px;
    text-align: left;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 12px;
    cursor: pointer;
    color: #e9edf4;
  }
  .scenery-del:hover {
    border-color: #ff5cb8;
    color: #ff5cb8;
  }
  .scenery-restore:hover {
    border-color: #4af2ff;
    color: #4af2ff;
  }

  .ghd-action {
    margin-left: auto;
    font: inherit;
    font-size: 11px;
    color: #8a93a3;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 1px 6px;
    cursor: pointer;
    text-transform: lowercase;
    letter-spacing: 0.05em;
  }
  .ghd-action:hover {
    color: #4af2ff;
    border-color: #4af2ff;
  }

  /* ── Properties ─────────────────────────────────────────────── */
  .props {
    position: absolute;
    top: 66px;
    right: 12px;
    bottom: 12px;
    width: 264px;
    z-index: 15;
    background: rgba(16, 19, 26, 0.86);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 14px;
    overflow-y: auto;
  }
  .props h3 {
    font-size: 11px;
    letter-spacing: 0.22em;
    color: #8a93a3;
    text-transform: uppercase;
    margin: 0 0 9px;
  }
  .empty {
    color: #8a93a3;
    font-size: 13.5px;
    line-height: 1.7;
    margin-top: 8px;
  }
  .multi-banner {
    background: rgba(187, 134, 252, 0.12);
    border: 1px solid rgba(187, 134, 252, 0.4);
    border-radius: 8px;
    padding: 9px 12px;
    margin-bottom: 12px;
    font-size: 12.5px;
    line-height: 1.5;
    color: #d8c8ff;
  }
  .multi-banner b {
    color: #fff;
  }
  .inspector-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 0 0 12px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
  }
  .inspector-tab {
    font: inherit;
    font-size: 12px;
    color: #aeb5c2;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 7px 8px;
    cursor: pointer;
  }
  .inspector-tab:hover:not(:disabled) {
    border-color: rgba(187, 134, 252, 0.45);
    color: #fff;
  }
  .inspector-tab.active {
    background: #bb86fc;
    color: #150d22;
    font-weight: 700;
  }
  .inspector-tab:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── HUD ────────────────────────────────────────────────────── */
  .hud {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 14;
    display: flex;
    gap: 14px;
    align-items: center;
    font-size: 12px;
    color: #8a93a3;
    background: rgba(16, 19, 26, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    padding: 8px 18px;
    backdrop-filter: blur(10px);
  }
  .hud b {
    color: #e9edf4;
    font-weight: 600;
  }
  .kbd {
    font-family: 'IBM Plex Mono', monospace;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    padding: 1px 6px;
    color: #c4ccd8;
    font-size: 11px;
    margin: 0 2px;
  }
  .multi-pill {
    background: rgba(187, 134, 252, 0.18);
    color: #fff;
    border: 1px solid rgba(187, 134, 252, 0.5);
    border-radius: 12px;
    padding: 2px 9px;
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  .toast {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    background: #10131a;
    border: 1px solid #4af2ff;
    color: #e9edf4;
    font-size: 13.5px;
    padding: 10px 18px;
    border-radius: 9px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  @media (max-width: 880px) {
    .lib, .props, .hud { display: none; }
  }
</style>
