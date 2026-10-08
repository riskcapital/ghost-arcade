<script lang="ts">
  /**
   * Interactive Studio editor.
   *
   * This component owns the scene, the undo history, the preview loop and the
   * camera / file plumbing, and lays out the parts:
   *
   *   InteractiveHeader        title bar and output controls
   *   InteractiveToolbar       Select / Draw / Play, undo, pause, restart
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
    type SurfaceMaterial,
  } from '../../mobile/studio/interactive';
  import {
    effectParams,
    editableEffects,
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
  import { importCornerSurfaces } from '../../mobile/studio/surfaceEditing';
  import * as edit from '../../mobile/studio/editorActions';
  import { pushSnapshot, popSnapshot } from '../../mobile/studio/editorHistory';
  import { editorKeyCommands, consumesKeyPress } from '../../mobile/studio/editorKeyboard';
  import { DesktopFeedPreview } from '../../mobile/studio/desktopFeed';
  import { shareInteractiveScene } from '../../mobile/studio/captureToolkit';
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
  export let captureScene: (scene: InteractiveScene) => InteractiveScene = (s) => s;
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
  const PREVIEW_WIDTH = 960;
  const PREVIEW_HEIGHT = 540;
  const legacySceneKey = 'ghost-interactive-scene-v1';

  let scene = defaultInteractive();
  let history: InteractiveScene[] = [];
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
  let fx: HTMLCanvasElement;
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

  // ── Undo ─────────────────────────────────────────────────────────────────
  function checkpoint() {
    history = pushSnapshot(history, scene);
  }
  function undo() {
    const { entries, snapshot } = popSnapshot(history);
    if (!snapshot) return;
    history = entries;
    restore(snapshot);
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
    world.reset();
    fx?.getContext('2d')?.clearRect(0, 0, fx.width, fx.height);
  }

  // ── Modes and keys ───────────────────────────────────────────────────────
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
  function keyboard(e: KeyboardEvent) {
    if (!(e.target instanceof HTMLElement)) return;
    const commands = editorKeyCommands({
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      fromControl: !!e.target.closest('input,select,textarea,button'),
    });
    for (const command of commands) {
      if (consumesKeyPress(command)) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (command === 'remove-surface') removeSurface();
      else if (command === 'undo') undo();
      else setMode('edit');
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────
  function patchEffect(patch: Partial<InteractiveEffect>, record = true) {
    if (record) checkpoint();
    scene = edit.patchEffect(scene, selectedEffect, patch);
  }
  function effectValue(def: EffectParam, value: number) {
    if (!activeEffect) return;
    patchEffect({ params: { ...activeEffect.params, [def.key]: value } }, false);
    onparam(activeEffect.id, def.key, value, def.label);
  }
  function effectAuto(key: string, value: AutoConfig | undefined) {
    if (!activeEffect) return;
    const paramAuto = { ...activeEffect.paramAuto };
    if (value) paramAuto[key] = value;
    else delete paramAuto[key];
    patchEffect({ paramAuto }, false);
  }
  function effectMod(key: string, value: ParamModulation | undefined) {
    if (!activeEffect) return;
    const mods = { ...activeEffect.mods };
    if (value) mods[key] = value;
    else delete mods[key];
    patchEffect({ mods }, false);
  }
  function addEffect(kind: EffectKind, target = 'point') {
    const added = edit.addEffect(scene, kind, target);
    if (!added) return;
    checkpoint();
    scene = added.scene;
    selectedEffect = added.effect.id;
    inspector = 'effects';
  }
  function removeEffect() {
    checkpoint();
    scene = edit.removeEffect(scene, selectedEffect);
    selectedEffect = scene.effects?.at(-1)?.id ?? '';
  }
  function toggleEffect(id: string) {
    checkpoint();
    scene = edit.toggleEffect(scene, id);
  }
  function reorder(from: string, to: string) {
    checkpoint();
    scene = edit.moveEffect(scene, from, to);
  }
  function moveEffect(delta: number) {
    const i = effects.findIndex((e) => e.id === selectedEffect);
    if (effects[i + delta]) reorder(selectedEffect, effects[i + delta].id);
  }
  function selectEffect(id: string) {
    selectedEffect = id;
    placingEmitter = false;
  }
  function togglePlacing() {
    placingEmitter = !placingEmitter;
    setMode('edit');
  }
  function placeEmitter(p: Point, start: boolean) {
    if (start) checkpoint();
    if (activeEffect) scene = edit.placeEmitter(scene, activeEffect, p);
  }
  function addKeyframe(def: EffectParam) {
    if (!activeEffect) return;
    onkeyframe?.(activeEffect.id, def.key, activeEffect.params[def.key] ?? def.value, def.label);
    message = `Keyframe added: ${def.label}`;
  }

  // ── Objects ──────────────────────────────────────────────────────────────
  function quickShape(kind: edit.ShapeKind) {
    const added = edit.addShape(scene, kind);
    if (!added) return;
    checkpoint();
    scene = added.scene;
    selected = added.surface.id;
    inspector = 'objects';
    setMode('edit');
  }
  function finishDraft() {
    const added = edit.addDrawnSurface(scene, draft);
    if (!added) return;
    checkpoint();
    scene = added.scene;
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
    checkpoint();
    scene = edit.removeSurface(scene, selected);
    selected = scene.surfaces[0]?.id ?? '';
  }
  function duplicate() {
    if (!chosen) return;
    const added = edit.duplicateSurface(scene, selected);
    if (!added) return;
    checkpoint();
    scene = added.scene;
    selected = added.surface.id;
  }
  function transform(scale: number, angle = 0) {
    if (!chosen) return;
    checkpoint();
    scene = edit.transformSurface(scene, selected, scale, angle);
  }
  function rename(value: string) {
    if (!chosen || value === chosen.name) return;
    checkpoint();
    scene = edit.renameSurface(scene, selected, value);
  }
  function behavior(value: Behavior) {
    checkpoint();
    scene = edit.setSurfaceBehavior(scene, selected, value);
  }
  function importMapping() {
    checkpoint();
    const surfaces = importCornerSurfaces(mappingSurfaces);
    if (!surfaces.length) {
      message = 'No corner-mapped surfaces to import.';
      return;
    }
    try {
      restore({ ...scene, surfaces });
      message = 'Copied corner-mapped surfaces. Mesh surfaces are omitted; changes here stay independent.';
    } catch (e) {
      message = (e as Error).message;
    }
  }
  /** Not reachable from the editor today. */
  function material(value: SurfaceMaterial) {
    if (!chosen) return;
    checkpoint();
    scene = { ...scene, surfaces: scene.surfaces.map((s) => (s.id === selected ? { ...s, material: value } : s)) };
    message =
      value === 'fire'
        ? `${chosen.name} is burning. Drag it to move the flame source.`
        : value === 'none'
          ? 'Surface effect removed.'
          : '';
  }
  /** Not reachable from the editor today. */
  function preset(value: InteractiveScene['preset']) {
    checkpoint();
    const effect: SurfaceMaterial | undefined =
      value === 'fire'
        ? 'fire'
        : value === 'smoke'
          ? 'smoke'
          : value === 'liquid'
            ? 'liquid'
            : value === 'cloud'
              ? 'points'
              : undefined;
    scene = {
      ...scene,
      preset: value,
      seed: ((scene.seed ?? 0) + 1) % 1000000,
      surfaces: scene.surfaces.map((s) => (effect && s.id === selected ? { ...s, material: effect } : s)),
    };
    world.reset();
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
      draftStatus = 'Not saved — export a backup';
    }
  }
  function useStarter(id: InteractiveStarter) {
    checkpoint();
    const next = starterScene(id);
    restore(next);
    onrestore(next);
    inspector = 'effects';
    setMode('perform');
    message = 'Scene ready. Drag the preview to interact. Undo restores your previous scene.';
  }
  function recallSaved(id: string) {
    const found = savedScenes.find((s) => s.id === id);
    if (!found) return;
    checkpoint();
    restore(found.scene);
    onrestore(found.scene);
    inspector = 'effects';
    message = 'Saved scene loaded. Undo restores your previous scene.';
  }
  function removeSaved(id: string) {
    try {
      const found = savedScenes.find((s) => s.id === id);
      savedScenes = removeInteractivePreset(localStorage, id);
      removedScene = found;
      message = 'Saved scene removed. Your current draft is unchanged.';
    } catch (e) {
      message = (e as Error).message;
    }
  }
  function undoRemoveSaved() {
    if (!removedScene) return;
    try {
      savedScenes = restoreInteractivePreset(localStorage, removedScene);
      removedScene = undefined;
      message = 'Saved scene restored.';
    } catch (e) {
      message = (e as Error).message;
    }
  }
  function savePreset() {
    try {
      savedScenes = saveInteractivePreset(localStorage, captureScene(scene));
      draftSave();
      message = 'Saved a new scene in your library.';
    } catch (e) {
      message = (e as Error).message;
    }
  }
  /** Not reachable from the editor today. */
  function save() {
    try {
      localStorage.setItem(legacySceneKey, JSON.stringify(validateScene(captureScene(scene))));
      message = 'Scene saved on this device.';
    } catch (e) {
      message = 'Could not save: ' + (e as Error).message;
    }
  }
  /** Not reachable from the editor today. */
  function load() {
    try {
      const saved = localStorage.getItem(legacySceneKey);
      if (!saved) throw Error('No saved scene yet.');
      const next = validateScene(JSON.parse(saved));
      checkpoint();
      restore(next);
      onrestore(next);
      message = 'Scene restored.';
    } catch (e) {
      message = (e as Error).message;
    }
  }
  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error('Scene file is too large.');
      const next = validateScene(JSON.parse(await file.text()));
      checkpoint();
      restore(next);
      onrestore(next);
      message = 'Scene imported.';
    } catch (e) {
      message = (e as Error).message;
    }
    input.value = '';
  }
  async function exportFile() {
    try {
      const json = JSON.stringify(validateScene(captureScene(scene)));
      if (await shareInteractiveScene(json)) {
        message = 'Scene shared.';
        return;
      }
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })),
        a = document.createElement('a');
      a.href = url;
      a.download = 'Ghost-Interactive.ghostinteractive.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      message = 'Scene exported for Interactive Studio.';
    } catch (e) {
      message = (e as Error).message;
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
      message = s;
      motion = [];
    });
    preview = next;
    try {
      await onpreparecamera();
      await next.start();
      if (token === epoch)
        message =
          'Camera is a local reference. Enable Motion input to interact; this is not calibrated projector tracking.';
    } catch (e) {
      if (token === epoch) {
        message = (e as Error).message;
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
      message = (e as Error).message;
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
      message = (e as Error).message;
      return;
    }
    message = nativeOutput
      ? outputActive
        ? 'Native GPU layer is live. The editor shows the same simulation before output warping.'
        : 'Native interactive layer stopped.'
      : outputActive && remoteOutput
        ? 'Sending the clean scene to desktop. Connection status appears above.'
        : outputActive
          ? 'Interactive scene selected for the app’s clean external output. Connect a display using Output settings.'
          : 'Studio mix restored to external output.';
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
    world.draw(fx.getContext('2d')!, scene, PREVIEW_WIDTH, PREVIEW_HEIGHT, paused ? 0 : dt);
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
    c.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    if (camera && preview) {
      c.globalAlpha = cameraOpacity;
      c.drawImage(cameraCanvas!, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      c.globalAlpha = 1;
    }
    c.globalCompositeOperation = 'screen';
    c.drawImage(fx, 0, 0);
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
    ready = true;
    saveTimer = setInterval(draftSave, 1000);
    fx = document.createElement('canvas');
    fx.width = PREVIEW_WIDTH;
    fx.height = PREVIEW_HEIGHT;
    small = document.createElement('canvas');
    small.width = 64;
    small.height = 36;
    canvas!.width = PREVIEW_WIDTH;
    canvas!.height = PREVIEW_HEIGHT;
    programCanvas!.width = PREVIEW_WIDTH;
    programCanvas!.height = PREVIEW_HEIGHT;
    raf = requestAnimationFrame(frame);
  });
  onDestroy(() => {
    draftSave();
    clearInterval(saveTimer);
    world.dispose();
    program.dispose();
    flush();
    mobileAudio?.stop();
    alive = false;
    cancelAnimationFrame(raf);
    stopCamera();
    pointers.clear();
    if (outputActive && !nativeOutput) onoutput(null);
  });
</script>

<section
  class="interactive-workspace"
  class:studio-fullscreen={fullScreen}
  class:native-editor={nativePreview}
  class:handheld
  class:clean-preview={cleanPreview}
  aria-label="Interactive Studio"
  onkeydown={keyboard}
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
        canUndo={history.length > 0}
        {paused}
        onmode={chooseMode}
        onundo={undo}
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
            : 'Layer stopped — launch to preview'
          : ''}
        onedit={checkpoint}
        onselect={(id) => (selected = id)}
        onpoints={(id, points) => (scene = edit.setSurfacePoints(scene, id, points))}
        onvertex={(id, index, point) => (scene = edit.moveSurfaceVertex(scene, id, index, point))}
        ondraftpoint={addDraftPoint}
        onplace={placeEmitter}
        oninteract={interact}
        onrelease={(id) => pointers.delete(id)}
      />
      <InteractiveStageTools
        {mode}
        {placingEmitter}
        {handheld}
        bind:tool
        draftLength={draft.length}
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
        <button class:active={inspector === 'presets'} onclick={() => (inspector = 'presets')}>Scenes</button>
        <button class:active={inspector === 'effects'} onclick={() => (inspector = 'effects')}>✦ Effects</button>
        <button
          class:active={inspector === 'objects'}
          onclick={() => {
            inspector = 'objects';
            chooseMode('edit');
          }}
        >
          ▧ Objects
        </button>
        <button class:active={inspector === 'scene'} onclick={() => (inspector = 'scene')}>Setup</button>
      </nav>
      <div class="inspector-body">
        <p role="status">{message}</p>
        {#if inspector === 'presets'}
          <InteractiveScenesPanel
            {savedScenes}
            {removedScene}
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
            ontoggle={toggleEffect}
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
            onpatch={(patch) => patchEffect(patch)}
            onplacing={togglePlacing}
            onstart={checkpoint}
            onvalue={effectValue}
            onmod={effectMod}
            onauto={effectAuto}
            onkeyframe={addKeyframe}
          />
        {:else if inspector === 'objects'}
          <InteractiveObjectsPanel
            surfaces={scene.surfaces}
            {selected}
            canImportMapping={mappingSurfaces.some((s) => s.enabled && s.mode === 'corners')}
            onshape={quickShape}
            onselect={selectSurface}
            onrename={rename}
            onbehavior={behavior}
            onheightstart={checkpoint}
            onheight={(height) => (scene = edit.setSurfaceHeight(scene, selected, height))}
            onattach={(kind) => addEffect(kind, selected)}
            ontransform={transform}
            onduplicate={duplicate}
            ondelete={removeSurface}
            onimportmapping={importMapping}
          />
        {:else}
          <InteractiveSetupPanel
            {nativeOutput}
            {audioOn}
            sceneName={scene.name}
            saveStatus={persistDraft ? draftStatus : 'Export your scene to keep a portable copy.'}
            bind:facing
            {camera}
            {cameraBusy}
            bind:motionEnabled
            bind:sensitivity
            bind:cameraOpacity
            ontoggleaudio={toggleAudio}
            onnamestart={checkpoint}
            onname={(name) => (scene = { ...scene, name: name.slice(0, 120) })}
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
  <slot name="timeline" />
</section>
