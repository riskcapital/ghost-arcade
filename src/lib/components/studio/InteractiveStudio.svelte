<script lang="ts">
  /**
   * Interactive Studio editor.
   *
   * This component owns the scene, the undo history, the preview loop, the
   * keyboard and the camera / file plumbing, and lays out the parts:
   *
   *   InteractiveHeader        title bar and output controls
   *   InteractiveToolbar       Select / Draw / Play, undo, redo, pause, restart
   *   InteractiveStage         preview canvases, shape overlay, pointer input
   *   InteractiveStageTools    hint line and the tools of the current mode
   *   Interactive*Panel        the four inspector tabs
   *
   * Scene edits are pure functions in mobile/studio/editorActions.ts, undo in
   * editorHistory.ts, the key map in editorKeyboard.ts. Styles for the whole
   * editor are in interactiveStudio.css.
   *
   * The same files run on desktop (native preview) and on the phone and tablet
   * (`handheld`), so every change has to work with touch as well.
   */
  import './interactiveStudio.css';
  import { onMount, onDestroy, tick } from 'svelte';
  import type { AutoConfig } from '../../types';
  import type { ParamModulation } from '../../audio/modulationControls';
  import { getVisualAudioSnapshot } from '../../audio/visualAudio';
  import { StandaloneAudio } from '../../mobile/standaloneAudio';
  import { InteractiveProgram } from '../../mobile/studio/interactiveProgram';
  import {
    defaultInteractive,
    validateScene,
    InteractiveWorld,
    MotionSensor,
    defaultMatter,
    type InteractiveScene,
    type Point,
    type Interaction,
    type Behavior,
  } from '../../mobile/studio/interactive';
  import {
    effectParams,
    editableEffects,
    MAX_INTERACTIVE_EFFECTS,
    type EffectKind,
    type EffectParam,
    type InteractiveEffect,
  } from '../../mobile/studio/interactiveEffects';
  import {
    starterScene,
    readInteractiveDraft,
    writeInteractiveDraft,
    readInteractivePresets,
    saveInteractivePreset,
    removeInteractivePreset,
    restoreInteractivePreset,
    type InteractiveStarter,
    type SavedInteractiveScene,
  } from '../../mobile/studio/interactiveLibrary';
  import { DEFAULT_ASPECT, importCornerSurfaces } from '../../mobile/studio/surfaceEditing';
  import * as edit from '../../mobile/studio/editorActions';
  import * as past from '../../mobile/studio/editorHistory';
  import { editorKey, type EditorKeyCommand } from '../../mobile/studio/editorKeyboard';
  import { DesktopFeedPreview } from '../../mobile/studio/desktopFeed';
  import { shareInteractiveScene } from '../../mobile/studio/captureToolkit';
  import { dialogHostOf, isCovered, keyTargetOf, trapTab } from './interactiveEditorFocus';
  import type { EditorMode, EmitterMarker, InspectorTab, TouchTool } from './interactiveEditorTypes';
  import InteractiveHeader from './InteractiveHeader.svelte';
  import InteractiveToolbar from './InteractiveToolbar.svelte';
  import InteractiveStage from './InteractiveStage.svelte';
  import InteractiveStageTools from './InteractiveStageTools.svelte';
  import InteractiveScenesPanel from './InteractiveScenesPanel.svelte';
  import InteractiveEffectStack from './InteractiveEffectStack.svelte';
  import InteractiveEffectParams from './InteractiveEffectParams.svelte';
  import InteractiveObjectsPanel from './InteractiveObjectsPanel.svelte';
  import InteractiveSetupPanel from './InteractiveSetupPanel.svelte';

  // ── Props ────────────────────────────────────────────────────────────────
  export let outputLevel = 1,
    outputHeld = false,
    outputBlackout = false;
  export let onpreparecamera: () => Promise<void> = async () => {};
  export let referencePreview = false;
  export let handheld = false;
  export let visible = true;
  export let persistDraft = false;
  export let outputLabel = '';
  export let onoutputsettings: (() => void) | undefined = undefined;
  export let onclose: () => void;
  export let remoteOutput = false;
  export let nativeOutput = false;
  export let nativeFrame: ((canvas: HTMLCanvasElement) => Promise<boolean>) | undefined = undefined;
  export let initialActive = false;
  export let initialPaused = false;
  /** Returns the scene as it should be saved; the desktop adds the layer's keyframe tracks. */
  export let captureScene: (scene: InteractiveScene) => InteractiveScene = (s) => s;
  /** A whole scene was loaded (or a load was undone): the host restores its keyframe tracks from it. */
  export let onrestore: (scene: InteractiveScene) => void = () => {};
  export let onparam: (effectId: string, key: string, value: number, label: string) => void = () => {};
  export let onkeyframe: ((effectId: string, key: string, value: number, label: string) => void) | undefined =
    undefined;
  export let ontimeline: (() => void) | undefined = undefined;
  export let initialScene: InteractiveScene | null = null;
  export let onscene: (
    scene: InteractiveScene,
    inputs: Interaction[],
    active: boolean,
    paused: boolean,
  ) => void = () => {};
  export let mappingSurfaces: { name: string; points: Point[]; enabled: boolean; mode: string }[] = [];
  export let onoutput: (canvas: HTMLCanvasElement | null) => void = () => {};
  /**
   * Width ÷ height of the composition the scene plays in. The stage, the shape
   * overlay and all pointer maths follow it, so a circle here is a circle in
   * the output. Optional: 16:9 when the host does not pass it.
   */
  export let aspect = DEFAULT_ASPECT;

  // ── Methods the host calls ───────────────────────────────────────────────
  export function previewOutput() {
    cleanPreview = true;
  }
  export function restoreMix() {
    if (outputActive) sendOutput();
  }
  /** Drop live touches and publish the scene once more (before closing or hiding). */
  export function flush() {
    pointers.clear();
    motion = [];
    onscene(scene, [], outputActive, paused);
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Longest side of the preview canvases the phone simulation draws into. */
  const PREVIEW_LONG_SIDE = 960;
  /** Arrow-key step as a fraction of the stage width; Shift moves ten times as far. */
  const NUDGE_STEP = 1 / 400;
  const MESSAGE_MS = 6000;

  /** One undo step: the scene and what was selected in it. */
  type Snapshot = {
    scene: InteractiveScene;
    selected: string;
    selectedEffect: string;
    /** The scene carries the keyframe tracks (taken around a scene load). */
    tracks: boolean;
  };
  /** A question shown in the inspector before a destructive step. */
  type Question = { title: string; detail: string; action: string; run: () => void };

  let root: HTMLElement;
  let scene = defaultInteractive();
  let history = past.emptyHistory<Snapshot>();
  let mode: EditorMode = 'edit';
  let inspector: InspectorTab = 'effects';
  let selected = 'stage';
  let selectedEffect = '';
  let lastEffect = '';
  let advanced = false;
  let placingEmitter = false;
  let draft: Point[] = [];
  let tool: TouchTool = 'attract';
  let message = '';
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  let question: Question | null = null;
  let questionButton: HTMLButtonElement | undefined;
  let fullScreen = false;
  let cleanPreview = false;

  // Legacy single-effect controls. They are copied into every published scene.
  let energy = 0.6,
    gravity = 0.25,
    trails = 0.7,
    hue = 185,
    matter = defaultMatter();

  // Output and preview.
  let paused = initialPaused;
  let outputActive = initialActive;
  let program = new InteractiveProgram();
  let world = new InteractiveWorld();
  let stageView: InteractiveStage | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let programCanvas: HTMLCanvasElement | undefined;
  let fx: HTMLCanvasElement | undefined;
  let nativeReady = false,
    nativeFrameAt = 0,
    nativeFailures = 0;
  let qualityLabel = '',
    lastQualityAt = 0,
    lastMobileFrame = 0;
  let raf = 0,
    last = 0,
    lastPublish = 0,
    alive = true;

  // Live input: touches on the stage and motion seen by the camera.
  let pointers = new Map<number, Interaction>();
  let motion: Interaction[] = [];

  // Camera reference and motion sensing.
  let cameraCanvas: HTMLCanvasElement | undefined;
  let small: HTMLCanvasElement;
  let preview: DesktopFeedPreview | undefined;
  let sensor = new MotionSensor();
  let camera = false,
    cameraBusy = false,
    motionEnabled = false;
  let facing: 'rear' | 'front' = 'rear';
  let cameraOpacity = 0.35,
    sensitivity = 0.6;
  let lastSample = 0,
    epoch = 0;

  // Phone microphone (desktop uses the app's own audio input).
  let mobileAudio: StandaloneAudio | undefined,
    audioOn = false;

  // Drafts and the saved-scene library.
  let ready = false;
  let draftStatus = 'Saved on this device';
  let lastDraft = '';
  let saveTimer: ReturnType<typeof setInterval> | undefined;
  let savedScenes: SavedInteractiveScene[] = [];
  let removedScene: SavedInteractiveScene | undefined;

  // Keyboard and focus.
  let host: HTMLElement | null = null;
  let nativeDialog = false;
  let returnFocus: HTMLElement | null = null;

  // ── Derived ──────────────────────────────────────────────────────────────
  $: if (lastEffect !== selectedEffect) {
    lastEffect = selectedEffect;
    advanced = false;
  }
  $: if (ready && !visible) {
    flush();
    if (!outputActive) {
      stopCamera();
      mobileAudio?.stop();
      audioOn = false;
    }
  }
  $: effects = scene.effects ?? [];
  $: activeEffect = effects.find((e) => e.id === selectedEffect);
  $: definitions = activeEffect ? effectParams(activeEffect.kind) : [];
  $: scene = { ...scene, energy, gravity, trails, hue, matter };
  $: chosen = scene.surfaces.find((s) => s.id === selected);
  $: nativePreview = nativeOutput && !referencePreview;
  $: emitterMarker = emitterMarkerFor(activeEffect, definitions, placingEmitter, inspector);
  $: effectsFull = effects.length >= MAX_INTERACTIVE_EFFECTS;
  $: safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.max(0.2, Math.min(5, aspect)) : DEFAULT_ASPECT;
  $: previewWidth = safeAspect >= 1 ? PREVIEW_LONG_SIDE : Math.round(PREVIEW_LONG_SIDE * safeAspect);
  $: previewHeight = safeAspect >= 1 ? Math.round(PREVIEW_LONG_SIDE / safeAspect) : PREVIEW_LONG_SIDE;
  $: if (ready) sizePreview(previewWidth, previewHeight);

  function emitterMarkerFor(
    effect: InteractiveEffect | undefined,
    defs: EffectParam[],
    placing: boolean,
    tab: InspectorTab,
  ): EmitterMarker | null {
    if (!effect || !(placing || tab === 'effects')) return null;
    if (effect.kind !== 'light' && !(effect.target === 'point' && defs.some((d) => d.key === 'x'))) return null;
    return {
      x: effect.params.lightX ?? effect.params.x ?? 0.5,
      y: effect.params.lightY ?? effect.params.y ?? 0.5,
      label: effect.kind === 'light' ? 'LIGHT' : 'EMITTER',
    };
  }

  // ── Status line and questions ────────────────────────────────────────────
  /** Show a short status message. It clears itself after a few seconds. */
  function say(text: string) {
    message = text;
    clearTimeout(messageTimer);
    if (text) messageTimer = setTimeout(() => (message = ''), MESSAGE_MS);
  }
  function ask(next: Question) {
    question = next;
    void tick().then(() => questionButton?.focus({ preventScroll: false }));
  }
  function answer(yes: boolean) {
    const asked = question;
    question = null;
    if (yes) asked?.run();
    root?.focus({ preventScroll: true });
  }

  // ── Undo and redo ────────────────────────────────────────────────────────
  // One-step edits go through apply(). Gestures (drags, sliders, typing) call
  // beginEdit() when they start and touchEdit() after every change, so a whole
  // gesture is one step and a press that changes nothing is none.
  const sameScene = (a: Snapshot, b: Snapshot) => JSON.stringify(a.scene) === JSON.stringify(b.scene);

  function snapshot(tracks = false): Snapshot {
    return { scene: structuredClone(tracks ? captureScene(scene) : scene), selected, selectedEffect, tracks };
  }
  /** Replace the scene in one undoable step. Returns false when nothing changed. */
  function apply(next: InteractiveScene): boolean {
    if (next === scene) return false;
    const before = snapshot();
    if (JSON.stringify(before.scene) === JSON.stringify(next)) return false;
    history = past.record(history, before);
    scene = next;
    return true;
  }
  function beginEdit() {
    history = past.begin(history, snapshot());
  }
  function touchEdit() {
    if (history.pending) history = past.touch(history, { scene, selected, selectedEffect, tracks: false }, sameScene);
  }
  function undo() {
    const step = past.undo(history, (target) => snapshot(target.tracks));
    if (!step) return;
    history = step.history;
    restoreSnapshot(step.state);
  }
  function redo() {
    const step = past.redo(history, (target) => snapshot(target.tracks));
    if (!step) return;
    history = step.history;
    restoreSnapshot(step.state);
  }
  function restoreSnapshot(step: Snapshot) {
    const keepSurface = selected,
      keepEffect = selectedEffect;
    const bursts = new Map(effects.map((e) => [e.id, e.burst]));
    restore(step.scene);
    // A manual burst that already fired must not fire again because its counter went back.
    scene = {
      ...scene,
      effects: scene.effects?.map((e) => ({ ...e, burst: Math.max(e.burst, bursts.get(e.id) ?? 0) })),
    };
    const surface = (id: string) => scene.surfaces.some((s) => s.id === id);
    const effect = (id: string) => !!scene.effects?.some((e) => e.id === id);
    selected = surface(keepSurface) ? keepSurface : surface(step.selected) ? step.selected : selected;
    selectedEffect = effect(keepEffect)
      ? keepEffect
      : effect(step.selectedEffect)
        ? step.selectedEffect
        : selectedEffect;
    if (step.tracks) onrestore(step.scene);
  }
  /** Replace the whole scene (undo, starters, saved scenes, import). */
  function restore(s: InteractiveScene) {
    scene = validateScene(s);
    scene = { ...scene, effects: editableEffects(scene) };
    selectedEffect = (scene.effects?.find((e) => e.enabled) ?? scene.effects?.[0])?.id ?? '';
    matter = scene.matter ?? defaultMatter();
    energy = scene.energy;
    gravity = scene.gravity;
    trails = scene.trails;
    hue = scene.hue;
    selected = scene.surfaces[0]?.id ?? '';
    draft = [];
    placingEmitter = false;
    world.reset();
    fx?.getContext('2d')?.clearRect(0, 0, fx.width, fx.height);
  }
  function hasKeyframes(): boolean {
    const tracks = captureScene(scene).animation?.tracks ?? [];
    return tracks.some((t) => (t.keyframes?.length ?? 0) + (t.boolKeyframes?.length ?? 0) > 0);
  }
  /**
   * Load a whole scene. The step remembers the keyframe tracks along with the
   * scene, so Undo brings both back. Asks first when keyframes would go.
   */
  function loadScene(next: InteractiveScene, done: () => void) {
    const run = () => {
      history = past.record(history, snapshot(true));
      restore(next);
      onrestore(next);
      done();
    };
    if (!hasKeyframes()) return run();
    ask({
      title: 'Replace this scene?',
      detail: 'Its keyframes are replaced too. Undo brings the scene and its keyframes back.',
      action: 'Replace scene',
      run,
    });
  }

  // ── Modes ────────────────────────────────────────────────────────────────
  function setMode(value: EditorMode) {
    mode = value;
    pointers.clear();
    draft = [];
    stageView?.cancelDrag();
  }
  function chooseMode(value: EditorMode) {
    placingEmitter = false;
    setMode(value);
  }

  // ── Keyboard and focus ───────────────────────────────────────────────────
  // While the editor is open it owns the keyboard. Keys pressed inside it
  // arrive at onRootKey (after the control that had focus), keys pressed with
  // focus on the page or elsewhere in the host dialog at onWindowKey. Both stop
  // the key there, so the app behind never acts on it.
  function onRootKey(e: KeyboardEvent) {
    handleKey(e);
  }
  function onWindowKey(e: KeyboardEvent) {
    if (!visible || !root?.isConnected) return;
    const target = e.target instanceof Node ? e.target : null;
    if (target && root.contains(target)) return;
    const onPage = !target || target === document.body || target === document.documentElement;
    if (!onPage && !host?.contains(target)) return;
    if (onPage && isCovered(root, host)) return;
    // An open Mod tray closes itself on Escape.
    if (e.key === 'Escape' && root.querySelector('.mt')) return;
    handleKey(e);
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      if (host && !nativeDialog) trapTab(e, host);
      e.stopPropagation();
      return;
    }
    const target = keyTargetOf(e.target);
    // The embedded timeline plays and pauses on Space: let that one through.
    if (e.code === 'Space' && target === 'other' && root.querySelector('.studio-timeline > *')) return;
    const { command, preventDefault } = editorKey(
      { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, target },
      {
        mode,
        placingEmitter,
        draftPoints: draft.length,
        hasSelection: !!chosen,
        confirming: !!question,
        fullScreen,
        cleanPreview,
      },
    );
    e.stopPropagation();
    if (preventDefault) e.preventDefault();
    if (command) runKey(command, e);
  }
  function runKey(command: EditorKeyCommand, e: KeyboardEvent) {
    switch (command.type) {
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'remove-surface':
        return removeSurface();
      case 'nudge': {
        const step = NUDGE_STEP * (command.big ? 10 : 1);
        if (!e.repeat) beginEdit();
        scene = edit.nudgeSurface(scene, selected, command.dx * step, command.dy * step * safeAspect);
        return touchEdit();
      }
      case 'finish-shape':
        return finishDraft();
      case 'cancel-confirm':
        return answer(false);
      case 'leave-field':
        return (e.target as HTMLElement).blur();
      case 'exit-placing':
        placingEmitter = false;
        return;
      case 'exit-draw':
        return chooseMode('edit');
      case 'exit-clean-preview':
        cleanPreview = false;
        return;
      case 'exit-fullscreen':
        fullScreen = false;
        return;
      case 'close':
        return closeEditor();
    }
  }
  /** Move focus into the editor when it opens. A native `<dialog>` does this itself. */
  function takeFocus() {
    ({ host, native: nativeDialog } = dialogHostOf(root));
    if (nativeDialog) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }
  /** Give focus back to where it was once the dialog around the editor is gone. */
  function giveFocusBack() {
    const to = returnFocus,
      dialog = host;
    if (!to || nativeDialog) return;
    setTimeout(() => {
      if (dialog?.isConnected || !to.isConnected) return;
      const active = document.activeElement;
      if (!active || active === document.body) to.focus({ preventScroll: true });
    }, 0);
  }

  // ── Effects ──────────────────────────────────────────────────────────────
  /** Change a parameter, Mod or Auto setting of the selected effect as part of a gesture. */
  function adjustEffect(patch: Partial<InteractiveEffect>) {
    scene = edit.patchEffect(scene, selectedEffect, patch);
    touchEdit();
  }
  function effectValue(def: EffectParam, value: number) {
    if (!activeEffect) return;
    adjustEffect({ params: { ...activeEffect.params, [def.key]: value } });
    onparam(activeEffect.id, def.key, value, def.label);
  }
  function effectAuto(key: string, value: AutoConfig | undefined) {
    if (!activeEffect) return;
    const paramAuto = { ...activeEffect.paramAuto };
    if (value) paramAuto[key] = value;
    else delete paramAuto[key];
    adjustEffect({ paramAuto });
  }
  function effectMod(key: string, value: ParamModulation | undefined) {
    if (!activeEffect) return;
    const mods = { ...activeEffect.mods };
    if (value) mods[key] = value;
    else delete mods[key];
    adjustEffect({ mods });
  }
  function addEffect(kind: EffectKind, target = 'point') {
    const added = edit.addEffect(scene, kind, target);
    if (!added) return say(`All ${MAX_INTERACTIVE_EFFECTS} effect slots are in use. Remove one to add another.`);
    apply(added.scene);
    selectedEffect = added.effect.id;
    inspector = 'effects';
  }
  function removeEffect() {
    apply(edit.removeEffect(scene, selectedEffect));
    selectedEffect = scene.effects?.at(-1)?.id ?? '';
  }
  function reorder(from: string, to: string) {
    apply(edit.moveEffect(scene, from, to));
  }
  function moveEffect(delta: number) {
    const i = effects.findIndex((e) => e.id === selectedEffect);
    if (effects[i + delta]) reorder(selectedEffect, effects[i + delta].id);
  }
  function selectEffect(id: string) {
    selectedEffect = id;
    placingEmitter = false;
  }
  /** Fire a manual burst. Not an undo step: there is nothing to take back. */
  function triggerBurst() {
    if (activeEffect) scene = edit.patchEffect(scene, activeEffect.id, { burst: activeEffect.burst + 1 });
  }
  function togglePlacing() {
    placingEmitter = !placingEmitter;
    setMode('edit');
  }
  function moveEmitter(p: Point) {
    if (!activeEffect) return;
    const from =
      activeEffect.target === 'point' ? undefined : scene.surfaces.find((s) => s.id === activeEffect!.target);
    scene = edit.placeEmitter(scene, activeEffect, p);
    touchEdit();
    if (from && activeEffect.kind !== 'light')
      say(`${activeEffect.name} now emits from this point, not from ${from.name}.`);
  }
  function addKeyframe(def: EffectParam) {
    if (!activeEffect) return;
    onkeyframe?.(activeEffect.id, def.key, activeEffect.params[def.key] ?? def.value, def.label);
    say(`Keyframe added: ${def.label}`);
  }

  // ── Objects ──────────────────────────────────────────────────────────────
  function quickShape(kind: edit.ShapeKind) {
    const added = edit.addShape(scene, kind, safeAspect);
    if (!added) return;
    apply(added.scene);
    selected = added.surface.id;
    inspector = 'objects';
    setMode('edit');
  }
  function finishDraft() {
    const added = edit.addDrawnSurface(scene, draft);
    if (!added) return;
    apply(added.scene);
    selected = added.surface.id;
    draft = [];
    mode = 'edit';
  }
  function addDraftPoint(p: Point) {
    if (draft.length < edit.MAX_DRAFT_POINTS) draft = [...draft, p];
  }
  function selectSurface(id: string) {
    selected = id;
    setMode('edit');
  }
  function removeSurface() {
    if (!chosen) return;
    apply(edit.removeSurface(scene, selected));
    selected = scene.surfaces[0]?.id ?? '';
  }
  function duplicate() {
    const added = edit.duplicateSurface(scene, selected);
    if (!added) return;
    apply(added.scene);
    selected = added.surface.id;
  }
  function transform(scale: number, angle = 0) {
    if (!chosen) return;
    if (!apply(edit.transformSurface(scene, selected, scale, angle, safeAspect)))
      say(`No room to ${angle ? 'rotate' : 'scale'} ${chosen.name} here. Move it away from the edge first.`);
  }
  function rename(value: string) {
    if (chosen && value !== chosen.name) apply(edit.renameSurface(scene, selected, value));
  }
  function behavior(value: Behavior) {
    apply(edit.setSurfaceBehavior(scene, selected, value));
  }
  function importMapping() {
    const surfaces = importCornerSurfaces(mappingSurfaces);
    if (!surfaces.length) return say('No corner-mapped surfaces to import.');
    const before = snapshot();
    try {
      restore({ ...scene, surfaces });
      history = past.record(history, before);
      say('Copied corner-mapped surfaces. Mesh surfaces are omitted; changes here stay independent.');
    } catch (e) {
      say((e as Error).message);
    }
  }

  // ── Scene library, drafts, files ─────────────────────────────────────────
  function draftSave() {
    if (!persistDraft || !ready) return;
    try {
      const next = captureScene(scene),
        json = JSON.stringify(next);
      if (json === lastDraft) return;
      writeInteractiveDraft(localStorage, next);
      lastDraft = json;
      draftStatus = 'Saved on this device';
    } catch {
      draftStatus = 'Not saved. Export a backup.';
    }
  }
  function useStarter(id: InteractiveStarter) {
    loadScene(starterScene(id), () => {
      inspector = 'effects';
      setMode('perform');
      say('Scene ready. Drag the preview to interact. Undo restores your previous scene.');
    });
  }
  function recallSaved(id: string) {
    const found = savedScenes.find((s) => s.id === id);
    if (!found) return;
    loadScene(found.scene, () => {
      inspector = 'effects';
      say('Saved scene loaded. Undo restores your previous scene.');
    });
  }
  function removeSaved(id: string) {
    try {
      const found = savedScenes.find((s) => s.id === id);
      savedScenes = removeInteractivePreset(localStorage, id);
      removedScene = found;
      say(`Saved scene removed. Your current ${persistDraft ? 'draft' : 'scene'} is unchanged.`);
    } catch (e) {
      say((e as Error).message);
    }
  }
  function undoRemoveSaved() {
    if (!removedScene) return;
    try {
      savedScenes = restoreInteractivePreset(localStorage, removedScene);
      removedScene = undefined;
      say('Saved scene restored.');
    } catch (e) {
      say((e as Error).message);
    }
  }
  function savePreset() {
    try {
      savedScenes = saveInteractivePreset(localStorage, captureScene(scene));
      draftSave();
      say('Saved a new scene in your library.');
    } catch (e) {
      say((e as Error).message);
    }
  }
  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error('Scene file is too large.');
      const next = validateScene(JSON.parse(await file.text()));
      loadScene(next, () => say('Scene imported. Undo restores your previous scene.'));
    } catch (e) {
      say((e as Error).message);
    }
    input.value = '';
  }
  async function exportFile() {
    try {
      const json = JSON.stringify(validateScene(captureScene(scene)));
      if (await shareInteractiveScene(json)) return say('Scene shared.');
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })),
        a = document.createElement('a');
      a.href = url;
      a.download = 'Ghost-Interactive.ghostinteractive.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      say('Scene exported for Interactive Studio.');
    } catch (e) {
      say((e as Error).message);
    }
  }

  // ── Camera and microphone ────────────────────────────────────────────────
  async function startCamera() {
    if (cameraBusy) return;
    stopCamera();
    const token = epoch;
    cameraBusy = true;
    camera = true;
    await tick();
    const next = new DesktopFeedPreview(cameraCanvas!, facing, (s) => {
      say(s);
      motion = [];
    });
    preview = next;
    try {
      await onpreparecamera();
      await next.start();
      if (token === epoch)
        say('Camera is a local reference. Enable Motion input to interact; this is not calibrated projector tracking.');
    } catch (e) {
      if (token === epoch) {
        say((e as Error).message);
        camera = false;
      }
    } finally {
      if (token === epoch) cameraBusy = false;
    }
  }
  function stopCamera() {
    epoch++;
    preview?.destroy();
    preview = undefined;
    camera = false;
    cameraBusy = false;
    motion = [];
    sensor.reset();
  }
  async function toggleAudio() {
    if (audioOn) {
      mobileAudio?.stop();
      audioOn = false;
      return;
    }
    try {
      mobileAudio ??= new StandaloneAudio();
      await mobileAudio.start();
      audioOn = true;
    } catch (e) {
      say((e as Error).message);
    }
  }

  // ── Output ───────────────────────────────────────────────────────────────
  function liveInputs(): Interaction[] {
    return [...pointers.values(), ...motion];
  }
  function sendOutput() {
    outputActive = !outputActive;
    try {
      if (!nativeOutput) onoutput(outputActive ? programCanvas! : null);
      onscene(scene, liveInputs(), outputActive, paused);
    } catch (e) {
      outputActive = false;
      say((e as Error).message);
      return;
    }
    say(
      nativeOutput
        ? outputActive
          ? 'Native GPU layer is live. The editor shows the same simulation before output warping.'
          : 'Native interactive layer stopped.'
        : outputActive && remoteOutput
          ? 'Sending the clean scene to desktop. Connection status appears above.'
          : outputActive
            ? 'Interactive scene selected for the app’s clean external output. Connect a display using Output settings.'
            : 'Studio mix restored to external output.',
    );
  }
  function closeEditor() {
    draftSave();
    flush();
    onclose();
  }
  function interact(pointerId: number, interaction: Interaction, start: boolean) {
    if (start || pointers.has(pointerId)) pointers.set(pointerId, interaction);
  }

  // ── Preview loop ─────────────────────────────────────────────────────────
  /** Size the canvases the phone simulation draws into to the composition's shape. */
  function sizePreview(width: number, height: number) {
    for (const target of [fx, canvas, programCanvas]) {
      if (!target || (target.width === width && target.height === height)) continue;
      // Native frames size the preview canvas themselves.
      if (target === canvas && nativePreview && nativeReady) continue;
      target.width = width;
      target.height = height;
    }
  }
  /** Camera motion becomes touch-like input, sampled ten times a second. */
  function sampleMotion(now: number) {
    if (camera && preview && motionEnabled && now - lastSample > 100) {
      lastSample = now;
      try {
        const c = small.getContext('2d', { willReadFrequently: true })!;
        c.drawImage(cameraCanvas!, 0, 0, 64, 36);
        motion = sensor.sample(c.getImageData(0, 0, 64, 36).data, 64, 36, sensitivity);
      } catch {
        motion = [];
      }
    } else if (!motionEnabled) motion = [];
  }
  /** Desktop: the core renders the scene; copy its latest frame into the stage. */
  function requestNativeFrame(now: number) {
    if (!nativeFrame || now - nativeFrameAt <= 1000 / 30) return;
    nativeFrameAt = now;
    void nativeFrame(canvas!).then((ok) => {
      if (ok) {
        nativeReady = true;
        nativeFailures = 0;
      } else if (++nativeFailures > 90) nativeReady = false;
    });
  }
  /** Phone and tablet: simulate and draw the scene here. */
  function simulate(now: number, dt: number) {
    const audio = getVisualAudioSnapshot();
    let bands: Record<string, number> = {
      ...audio.bands,
      amplitude: audio.energy,
      kick: audio.kick,
      snare: audio.snare,
    };
    if (audioOn && mobileAudio) {
      mobileAudio.update(now);
      const a = mobileAudio.uniforms;
      bands = {
        bass: a.audioBass,
        sub: a.audioBass,
        mid: a.audioMid,
        lowMid: a.audioMid,
        highMid: a.audioHigh,
        treble: a.audioHigh,
        air: a.audioHigh,
        high: a.audioHigh,
        presence: a.audioHigh,
        amplitude: a.audioLevel,
        kick: a.audioBass,
        snare: a.audioHigh,
      };
    }
    world.update(scene, paused ? 0 : dt, liveInputs(), bands, audio.bpm || 120);
    world.draw(fx!.getContext('2d')!, scene, previewWidth, previewHeight, paused ? 0 : dt);
    if (now - lastQualityAt > 1500) {
      lastQualityAt = now;
      qualityLabel = world.qualityDiagnostics().description;
    }
  }
  /** Camera reference underneath, simulation on top, then the clean output copy. */
  function compose() {
    const c = canvas!.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#03060c';
    c.fillRect(0, 0, previewWidth, previewHeight);
    if (camera && preview) {
      c.globalAlpha = cameraOpacity;
      c.drawImage(cameraCanvas!, 0, 0, previewWidth, previewHeight);
      c.globalAlpha = 1;
    }
    c.globalCompositeOperation = 'screen';
    c.drawImage(fx!, 0, 0);
    c.globalCompositeOperation = 'source-over';
    if (outputActive || cleanPreview)
      program.draw(canvas!, programCanvas!, { held: outputHeld, blackout: outputBlackout, level: outputLevel });
  }
  function frame(now: number) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!nativeOutput || referencePreview) {
      if (now - lastMobileFrame < 1000 / 30 - 1) return;
      lastMobileFrame = now;
    }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (document.hidden) {
      pointers.clear();
      motion = [];
      sensor.reset();
    }
    if (now - lastPublish > 50) {
      lastPublish = now;
      onscene(scene, liveInputs(), outputActive, paused);
    }
    if (document.hidden || (!visible && !outputActive)) return;
    sampleMotion(now);
    if (nativeOutput && !referencePreview) {
      requestNativeFrame(now);
      return;
    }
    simulate(now, dt);
    compose();
  }

  onMount(() => {
    outputActive = initialActive;
    const restored = initialScene ?? (persistDraft ? readInteractiveDraft(localStorage) : null);
    restore(restored ?? starterScene('balls'));
    if (persistDraft && !restored) inspector = 'presets';
    savedScenes = readInteractivePresets(localStorage);
    fx = document.createElement('canvas');
    small = document.createElement('canvas');
    small.width = 64;
    small.height = 36;
    sizePreview(previewWidth, previewHeight);
    ready = true;
    saveTimer = setInterval(draftSave, 1000);
    window.addEventListener('keydown', onWindowKey, true);
    takeFocus();
    raf = requestAnimationFrame(frame);
  });
  onDestroy(() => {
    draftSave();
    clearInterval(saveTimer);
    clearTimeout(messageTimer);
    window.removeEventListener('keydown', onWindowKey, true);
    world.dispose();
    program.dispose();
    flush();
    mobileAudio?.stop();
    alive = false;
    cancelAnimationFrame(raf);
    stopCamera();
    pointers.clear();
    if (outputActive && !nativeOutput) onoutput(null);
    giveFocusBack();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={root}
  class="interactive-workspace"
  class:studio-fullscreen={fullScreen}
  class:native-editor={nativePreview}
  class:handheld
  class:clean-preview={cleanPreview}
  style:--stage-aspect={safeAspect}
  aria-label="Interactive Studio"
  onkeydown={onRootKey}
  tabindex="-1"
>
  <InteractiveHeader
    engineLabel={referencePreview ? 'Local reference' : nativeOutput ? 'Native GPU' : 'Mobile'}
    {outputActive}
    {handheld}
    {nativeOutput}
    {fullScreen}
    showOutputStatus={handheld && !remoteOutput}
    {outputLabel}
    {ontimeline}
    onoutput={sendOutput}
    onfullscreen={() => (fullScreen = !fullScreen)}
    onclose={closeEditor}
    {onoutputsettings}
  />
  <div class="layout">
    <div class="work">
      <InteractiveToolbar
        {mode}
        {placingEmitter}
        canUndo={past.canUndo(history)}
        canRedo={past.canRedo(history)}
        {paused}
        onmode={chooseMode}
        onundo={undo}
        onredo={redo}
        onpause={() => (paused = !paused)}
        onrestart={() => {
          scene = edit.reseed(scene);
          world.reset();
        }}
      />
      <InteractiveStage
        bind:this={stageView}
        bind:canvas
        bind:programCanvas
        bind:cameraCanvas
        surfaces={scene.surfaces}
        {selected}
        {mode}
        {tool}
        {placingEmitter}
        {draft}
        aspect={safeAspect}
        emitter={emitterMarker}
        {camera}
        {cameraOpacity}
        {nativePreview}
        previewLabel={referencePreview
          ? 'Local reference preview'
          : nativeOutput
            ? 'Live native effect preview'
            : 'Interactive preview'}
        previewStatus={nativePreview && (!nativeReady || !outputActive)
          ? outputActive
            ? 'Waiting for native effect frames…'
            : 'Layer stopped. Launch to preview.'
          : ''}
        ongesture={beginEdit}
        onselect={(id) => (selected = id)}
        onpoints={(id, points) => {
          scene = edit.setSurfacePoints(scene, id, points);
          touchEdit();
        }}
        onvertex={(id, index, point) => {
          scene = edit.moveSurfaceVertex(scene, id, index, point);
          touchEdit();
        }}
        onemitter={moveEmitter}
        ondraftpoint={addDraftPoint}
        onfinish={finishDraft}
        oninteract={interact}
        onrelease={(id) => pointers.delete(id)}
      />
      <InteractiveStageTools
        {mode}
        {placingEmitter}
        {handheld}
        bind:tool
        draftLength={draft.length}
        markerName={emitterMarker?.label.toLowerCase() ?? ''}
        sourceLabel={referencePreview
          ? 'Local reference · desktop renders independently'
          : nativeOutput
            ? 'Live native source · before output warp'
            : qualityLabel || 'Mobile preview'}
        onundopoint={() => (draft = draft.slice(0, -1))}
        onfinish={finishDraft}
      />
    </div>
    <aside>
      <nav class="inspector-tabs" aria-label="Interactive tools">
        {#each [['presets', 'Scenes'], ['effects', 'Effects'], ['objects', 'Objects'], ['scene', 'Setup']] as [id, label]}
          <button
            class:active={inspector === id}
            aria-current={inspector === id ? 'true' : undefined}
            onclick={() => {
              inspector = id as InspectorTab;
              if (id === 'objects') chooseMode('edit');
            }}
          >
            {label}
          </button>
        {/each}
      </nav>
      <div class="inspector-body">
        {#if question}
          <div class="studio-question" role="alertdialog" aria-label={question.title}>
            <strong>{question.title}</strong>
            <p>{question.detail}</p>
            <div class="tools">
              <button class="danger" bind:this={questionButton} onclick={() => answer(true)}>{question.action}</button>
              <button onclick={() => answer(false)}>Cancel</button>
            </div>
          </div>
        {/if}
        <p role="status">{message}</p>
        {#if inspector === 'presets'}
          <InteractiveScenesPanel
            {savedScenes}
            {removedScene}
            {persistDraft}
            onstarter={useStarter}
            onsave={savePreset}
            onrecall={recallSaved}
            onremove={removeSaved}
            onundoremove={undoRemoveSaved}
          />
        {:else if inspector === 'effects'}
          <InteractiveEffectStack
            {effects}
            surfaces={scene.surfaces}
            {selectedEffect}
            onadd={(kind) => addEffect(kind)}
            onselect={selectEffect}
            ontoggle={(id) => apply(edit.toggleEffect(scene, id))}
            onreorder={reorder}
          />
          <InteractiveEffectParams
            effect={activeEffect}
            surfaces={scene.surfaces}
            canMoveUp={effects[0]?.id !== selectedEffect}
            canMoveDown={effects.at(-1)?.id !== selectedEffect}
            {placingEmitter}
            bind:advanced
            supportsCrossfader={nativeOutput}
            keyframes={!!onkeyframe}
            onmove={moveEffect}
            onremove={removeEffect}
            onpatch={(patch) => apply(edit.patchEffect(scene, selectedEffect, patch))}
            onburst={triggerBurst}
            onplacing={togglePlacing}
            onstart={beginEdit}
            onvalue={effectValue}
            onmod={effectMod}
            onauto={effectAuto}
            onkeyframe={addKeyframe}
          />
        {:else if inspector === 'objects'}
          <InteractiveObjectsPanel
            surfaces={scene.surfaces}
            {selected}
            {effectsFull}
            canImportMapping={mappingSurfaces.some((s) => s.enabled && s.mode === 'corners')}
            onshape={quickShape}
            onselect={selectSurface}
            onrename={rename}
            onbehavior={behavior}
            onheightstart={beginEdit}
            onheight={(height) => {
              scene = edit.setSurfaceHeight(scene, selected, height);
              touchEdit();
            }}
            onattach={(kind) => addEffect(kind, selected)}
            ontransform={transform}
            onduplicate={duplicate}
            ondelete={removeSurface}
            onimportmapping={importMapping}
          />
        {:else}
          <InteractiveSetupPanel
            {nativeOutput}
            {handheld}
            {audioOn}
            sceneName={scene.name}
            saveStatus={persistDraft
              ? draftStatus
              : 'This scene is part of your project. Export to keep a separate copy.'}
            bind:facing
            {camera}
            {cameraBusy}
            bind:motionEnabled
            bind:sensitivity
            bind:cameraOpacity
            ontoggleaudio={toggleAudio}
            onnamestart={beginEdit}
            onname={(name) => {
              scene = { ...scene, name: name.slice(0, 120) };
              touchEdit();
            }}
            onsave={savePreset}
            onscenes={() => (inspector = 'presets')}
            onexport={exportFile}
            onimport={importFile}
            onstartcamera={startCamera}
            onstopcamera={stopCamera}
          />
        {/if}
      </div>
    </aside>
  </div>
  {#if cleanPreview}
    <button class="return-preview" onclick={() => (cleanPreview = false)}>Back to Interactive</button>
  {/if}
  {#if $$slots.timeline}
    <div class="studio-timeline"><slot name="timeline" /></div>
  {/if}
</section>
