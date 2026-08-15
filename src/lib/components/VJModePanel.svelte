<script lang="ts">
  // VJ Mode Panel - Layers/Columns Grid
  // Uses vjClipLauncher store for state management

  import { onMount, onDestroy } from 'svelte';
  import { isMac, isDesktopApp, getTextureShareLabel, invoke } from '$lib/bridge';
  import { nativePreviewHostEl } from '../stores/nativePreviewHost';
  import { get } from 'svelte/store';
  import { mediaLibrary, type MediaItem } from '../stores/media';
  import { vjClipLauncher, type VJClip, type VJBlock, type VJDeck } from '../stores/vjClipLauncher';
  import { probeHasAudioTrack } from '../audio/clipAudioBus';
  import { vjLayerSequencer } from '../stores/vjLayerSequencer';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { workspace } from '../stores/workspace';
  import { project, stagePresets, compositions, activeCompositionId } from '../stores/layers';
  import { STAGE_EFFECT_CATALOG, getEffectDef } from '../stores/stageEffects';
  import { surfaceStore, activeSurface } from '../stores/surface';
  import { synthVisionStore } from '../stores/synthVision';
  import type { StageEffectType, IntegratedEffectType, IntegratedEffectSource, MediaSource } from '../types';

  // Stage Effects tab UX state — which effect type the user has
  // chosen in the "Add" picker. Defaults to the first catalog entry.
  let stageAddType: StageEffectType = STAGE_EFFECT_CATALOG[0].type;
  import { globalStagePresets } from '../stores/globalPresets';
  import { parseISF, getInputDefault } from '../isf/parser';
  import { generateCachedThumbnail as generateShaderThumbnail } from '../isf/thumbnail';
  import type { BlendMode, Effect, EffectType, ISFInputDef, JSAnimationSource, SplatContent, Model3DContent, Model3DFormat, SplatAnimationType, SplatDisplacementType, Model3DAnimationType, Model3DDeformationType, Model3DMaterialType, Model3DWireframeMode, Model3DLightingPreset } from '../types';
  import { generateUUID, createDefaultSplatContent, createDefaultModel3DContent, createDefaultGPULayerContent, createDefaultTextContent } from '../types';
  import { audioStore } from '../stores/audio';
  import { createAssetRefFromFile, createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';
  import ClipPreviewPanel from './ClipPreviewPanel.svelte';
  import { markUserInteracting } from '../midi/midiRouter';
  import { modulationStore, modulationEngine, setParamModSource, setCrossfaderModSource, updateParamMod, registerParamRanges, getModulatedValue, setBaseValue, clearBaseValues, clearModulatedValues, modKeyShader, MOD_KEY_XFADE_VALUE, type ModSource, type ParamModulation } from '../audio/modulation';
  import ModTray, { modSourceLabel } from './ModTray.svelte';
  import { defaultAutoFor } from '../audio/autoEngine';
  import type { AutoConfig } from '../types';
  import { performanceStore } from '../audio/performanceEngine';
  import type { ISFInput } from '../isf/parser';
  import { getPluginByEffectType, getAllPlugins } from '../plugins/registry';
  import PluginIcon from './PluginIcon.svelte';
  import PluginLayerPanel from './PluginLayerPanel.svelte';
  import MediaTray from './MediaTray.svelte';
  import AIShaderGenerator from './AIShaderGenerator.svelte';
  import AIVideoGenerator from './AIVideoGenerator.svelte';
  import { shaderLibrary } from '../stores/shaderLibrary';
  import { videoLibrary } from '../stores/videoLibrary';
  import { NATIVE_ENGINE_ONLY, settings } from '../stores/settings';
  import { startRecording as startRec, formatRecordingDuration, type RecorderHandle } from '../recording/recorder';
  import { showLoading } from '../stores/loading';
  import { showToast } from '../stores/errorToast';
  import { listScreenCaptureSources, screenCaptureSourcePickerAvailable, type ScreenCaptureSource } from '$lib/capture/screenSources';
  import SynthVision from './SynthVision.svelte';
  import VJAudioBar from './VJAudioBar.svelte';
  import AudioInputPicker from './AudioInputPicker.svelte';
  import AudioMeterPanel from './AudioMeterPanel.svelte';
  import MacroKnobBar from './MacroKnobBar.svelte';
  import SnapshotBank from './SnapshotBank.svelte';
  import VJLayerSequencer from './VJLayerSequencer.svelte';
  // VJAudioBar import retained for fallback / type compatibility but the
  // standalone strip below the header was dropped — its contents are now
  // inline in the header (single source of truth, no second tap/tempo row).
  void VJAudioBar;
  import { applyPresetToEffect, getEffectPresets, getNumericEffectParams, effectParamLabels } from '../effects/effectUX';
  import { EFFECT_CATALOG } from '../effects/effectCatalog';
  import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';
  import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
  import EffectParamRow from './EffectParamRow.svelte';
  // Tier-related imports removed — recording / Particles3D always available.
  import { getDefaultEffectParams as getRendererDefaultEffectParams } from '../renderer/effects';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import SplatPanel from './SplatPanel.svelte';
  import Model3DPanel from './Model3DPanel.svelte';
  import VJGPUClipPanel from './VJGPUClipPanel.svelte';
  import VJTextClipPanel from './VJTextClipPanel.svelte';
  import LEDFXPanel from './LEDFXPanel.svelte';
  import { getShaderDef } from '../renderer/gpuShaderCatalog';
  // Same build-time JS animation catalog used by mapping-mode MediaTray.
  // @ts-expect-error virtual module supplied by vite plugin
  import bundledThreeJSItems from 'virtual:threejs-bundles';

  // File menu callback (wired by parent App.svelte)
  export let onFileAction: ((action: 'new' | 'open' | 'save' | 'saveAs' | 'importPresets' | 'undo' | 'redo') => void) | null = null;
  let vjFileMenuOpen = false;
  function vjFileAction(action: 'new' | 'open' | 'save' | 'saveAs' | 'importPresets' | 'undo' | 'redo') {
    vjFileMenuOpen = false;
    onFileAction?.(action);
  }

  // VJ Plugins tab — mirrors the mapping-mode Media Library plugin set
  // (the shared plugin registry) so the two stay identical. Each card is
  // draggable: drop onto a clip slot to spawn an effect clip (the drop
  // handler seeds defaults from the manifest via getPluginByEffectType).
  // Point Cloud + 3D Model are VJ content types the registry doesn't
  // cover, appended at the end with their own inline icons.
  type VJPluginCard = {
    id: string;
    name: string;
    description: string;
    tier: string;
    clipType: 'effect' | 'splat' | 'model3d' | 'gpu' | 'text' | 'synthvision';
    effectType?: IntegratedEffectType;
    inlineIcon?: 'splat' | 'model3d' | 'gpu' | 'text' | 'synthvision';
  };

  const vjPluginCards: VJPluginCard[] = [
    { id: 'gpu-shader', name: 'GPU Shader', description: 'GPU visual instruments and particle shaders', tier: 'free', clipType: 'gpu', inlineIcon: 'gpu' },
    { id: 'text-creator', name: 'Text Creator', description: 'Live typography, animation, glow, and 3D text', tier: 'free', clipType: 'text', inlineIcon: 'text' },
    ...getAllPlugins().map((p): VJPluginCard => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tier: p.tier,
      clipType: 'effect',
      effectType: p.effectType,
    })),
    { id: 'performer', name: 'Performer', description: 'Keyboard-launched worlds, shaders and clips', tier: 'free', clipType: 'synthvision', inlineIcon: 'synthvision' },
    { id: 'pointcloud', name: 'Point Cloud', description: 'PLY point cloud / splat', tier: 'free', clipType: 'splat', inlineIcon: 'splat' },
    { id: 'model3d', name: '3D Model', description: 'GLTF/OBJ/FBX models', tier: 'free', clipType: 'model3d', inlineIcon: 'model3d' },
  ];

  // Performer panel state
  let showPerformer = false;
  let performerStarted = false; // Once started, keeps running in background

  // Media tray collapse state
  let mediaTrayCollapsed = false;

  // Effects tab: Composition / Layer / Clip / Stage.
  // Stage is the new tab — manages procedural per-slice stage effects
  // (radial pulse, sweep, chase, strobe, beat-pulse, …) that modulate
  // the bound mapping layers created by Apply Stage. Always available;
  // the only way to activate stage effects.
  let effectsTab: 'composition' | 'layer' | 'clip' | 'stage' | 'led' = 'layer';

  // Effect types available
  const effectTypes: { value: EffectType; label: string }[] =
    EFFECT_CATALOG.map((e) => ({ value: e.type, label: e.label }));

  // Expanded effect param
  let expandedEffectId: string | null = null;
  let showEffectPicker = false;
  let vjPresetSelection: Record<string, string> = {};
  let vjMacro1 = 0.5;
  let vjMacro2 = 0.5;
  let vjMacroBindings: Record<string, { m1?: string; m2?: string }> = {};

  let stageSaveScope: 'project' | 'global' = 'project';

  $: allStagePresets = [
    ...$stagePresets.map(p => ({ ...p, _scope: (p.scope || 'project') as 'project' | 'global' })),
    ...$globalStagePresets.map(p => ({ ...p, _scope: 'global' as const })),
  ];

  function loadStagePresetFromUI(preset: (typeof allStagePresets)[number]) {
    if (preset._scope === 'global') {
      project.loadStagePresetSnapshot(preset);
    } else {
      project.loadStagePreset(preset.id);
    }
  }

  // MIDI: bridge vj:stage:<index> triggers into loadStagePreset(). The
  // router fires `midi-stage-preset` events but nothing listened until
  // now. Index targets the combined project+global list (allStagePresets)
  // — same ordering the user binds against visually. Declared at module
  // top so onDestroy can remove it; attached in onMount, detached below.
  const stagePresetHandler = (e: Event) => {
    const idx = (e as CustomEvent<{ index: number }>).detail?.index;
    if (typeof idx !== 'number') return;
    const preset = allStagePresets[idx];
    if (preset) loadStagePresetFromUI(preset);
  };

  let heldStageEffects: Record<string, boolean> = {};
  let stageEffectHoldStack: string[] = [];
  let stageEffectHoldRestoreId: string | null = null;
  let stageEffectHoldRestoreAutomationPlaying: boolean | null = null;

  function setStageActiveEffect(effectId: string | null) {
    const surfaceId = $activeSurface?.id;
    if (!surfaceId) return;
    surfaceStore.setActiveEffect(surfaceId, effectId);
  }

  function toggleStageActiveEffect(effectId: string) {
    const surface = $activeSurface;
    if (!surface) return;
    if (surface.effectAutomation?.playing) {
      surfaceStore.updateEffectAutomation({ playing: false });
    }
    setStageActiveEffect(surface.activeEffectId === effectId ? null : effectId);
  }

  function setStageEffectHeld(effectId: string, held: boolean) {
    const next = { ...heldStageEffects };
    if (held) next[effectId] = true;
    else delete next[effectId];
    heldStageEffects = next;
  }

  function pressStageEffectHold(effectId: string) {
    if (!effectId || heldStageEffects[effectId]) return;
    if (stageEffectHoldStack.length === 0) {
      stageEffectHoldRestoreId = $activeSurface?.activeEffectId ?? null;
      stageEffectHoldRestoreAutomationPlaying = $activeSurface?.effectAutomation?.playing ?? false;
      if (stageEffectHoldRestoreAutomationPlaying) {
        surfaceStore.updateEffectAutomation({ playing: false });
      }
    } else {
      heldStageEffects = {};
      stageEffectHoldStack = [];
    }
    stageEffectHoldStack = [effectId];
    setStageEffectHeld(effectId, true);
    setStageActiveEffect(effectId);
  }

  function releaseStageEffectHold(effectId: string) {
    if (!effectId || !heldStageEffects[effectId]) return;
    const nextStack = stageEffectHoldStack.filter(id => id !== effectId);
    setStageEffectHeld(effectId, false);
    stageEffectHoldStack = nextStack;

    if (nextStack.length > 0) {
      setStageActiveEffect(nextStack[nextStack.length - 1]);
      return;
    }

    setStageActiveEffect(stageEffectHoldRestoreId ?? null);
    if (stageEffectHoldRestoreAutomationPlaying) {
      surfaceStore.updateEffectAutomation({ playing: true });
    }
    stageEffectHoldRestoreId = null;
    stageEffectHoldRestoreAutomationPlaying = null;
  }

  function releaseAllStageEffectHolds() {
    const hadHeldEffect = stageEffectHoldStack.length > 0;
    const restoreId = stageEffectHoldRestoreId;
    const restoreAutomation = stageEffectHoldRestoreAutomationPlaying;
    heldStageEffects = {};
    stageEffectHoldStack = [];
    stageEffectHoldRestoreId = null;
    stageEffectHoldRestoreAutomationPlaying = null;
    if (hadHeldEffect) setStageActiveEffect(restoreId ?? null);
    if (hadHeldEffect && restoreAutomation) surfaceStore.updateEffectAutomation({ playing: true });
  }

  function handleStageEffectHoldPointerDown(event: PointerEvent, effectId: string) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pressStageEffectHold(effectId);
  }

  function handleStageEffectHoldPointerEnd(event: PointerEvent, effectId: string) {
    event.preventDefault();
    event.stopPropagation();
    releaseStageEffectHold(effectId);
  }

  const stageEffectHoldHandler = (e: Event) => {
    const detail = (e as CustomEvent<{ effectId: string; pressed: boolean }>).detail;
    if (!detail?.effectId) return;
    if (detail.pressed) pressStageEffectHold(detail.effectId);
    else releaseStageEffectHold(detail.effectId);
  };

  // Stable index arrays for the clip-grid {#each ... (key)} loops. Without these,
  // `{#each Array($vjClipLauncher.numLayers)}` creates a fresh anonymous array
  // on every reactive tick, forcing Svelte to tear down and recreate every row
  // and every cell on every store change (incl. audio-driven ones). Keyed by
  // integer index so rows/cells keep their DOM when only the contents change.
  let layerIndices: number[] = [];
  let columnIndices: number[] = [];

  // ---- Deck resolution helpers --------------------------------------------
  // When the crossfader is on, the UI renders TWO complete decks side-by-side.
  // These helpers route reads to the right state slice based on the deck tag.
  // All write paths flow through `vjClipLauncher.<method>(..., deck)` which
  // takes the same VJDeck parameter.
  function deckGrid(bank: VJDeck): (VJClip | null)[][] {
    return bank === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
  }
  function deckLayerStates(bank: VJDeck) {
    return bank === 'B' ? $vjClipLauncher.bankBLayerStates : $vjClipLauncher.layerStates;
  }

  // (The pulsing ▶ scroll-hint was replaced with color-coded scrollbars
  // — cyan for Deck A, coral for Deck B — so users still get a visual cue
  // that more columns exist beyond the visible area without the chrome.)
  $: {
    const n = $vjClipLauncher.numLayers;
    if (layerIndices.length !== n) {
      layerIndices = Array.from({ length: n }, (_, i) => i);
    }
  }
  $: {
    const n = $vjClipLauncher.numColumns;
    if (columnIndices.length !== n) {
      columnIndices = Array.from({ length: n }, (_, i) => i);
    }
  }

  function getVJMacroBinding(effectId: string, which: 'm1' | 'm2'): string {
    return vjMacroBindings[effectId]?.[which] || '';
  }

  function setVJMacroBinding(effectId: string, which: 'm1' | 'm2', paramName: string) {
    const prev = vjMacroBindings[effectId] || {};
    vjMacroBindings = {
      ...vjMacroBindings,
      [effectId]: { ...prev, [which]: paramName || undefined },
    };
  }

  function saveStagePresetWithScope() {
    const name = `Preset ${allStagePresets.length + 1}`;
    if (stageSaveScope === 'global') {
      globalStagePresets.add(project.createStagePresetSnapshot(name, undefined, 'global'));
    } else {
      project.saveStagePreset(name);
    }
  }

  function deleteStagePreset(preset: any) {
    if (preset._scope === 'global') {
      globalStagePresets.remove(preset.id);
    } else {
      project.deleteStagePreset(preset.id);
    }
  }

  // Overwrite a stage preset with the CURRENT mapping layers. Triggered from
  // the right-click "Update Preset" item — saves the user from deleting +
  // re-saving when iterating on a layout under the same name.
  function updateStagePresetInPlace(preset: any) {
    if (preset._scope === 'global') {
      // Global presets: re-snapshot the full stage state and overwrite.
      const snapshot = project.createStagePresetSnapshot(
        preset.name,
        preset.thumbnail,
        'global',
        preset.id,
      );
      globalStagePresets.updateContents(preset.id, snapshot);
    } else {
      project.updateStagePreset(preset.id);
    }
  }

  // ===== Right-click context menus =====
  // Block tab right-click — gives quick access to "Save Project" so the
  // user can resave the .gha file without hunting for the File menu.
  function openBlockContextMenu(e: MouseEvent, blockId: string) {
    e.preventDefault();
    blockContextMenu = { x: e.clientX, y: e.clientY, blockId };
  }
  function closeBlockContextMenu() { blockContextMenu = null; }

  function blockMenuSaveProject() {
    blockContextMenu = null;
    onFileAction?.('save');
  }
  function blockMenuRename() {
    if (!blockContextMenu) return;
    const block = $vjClipLauncher.blocks.find(b => b.id === blockContextMenu!.blockId);
    blockContextMenu = null;
    if (block) startEditingBlock(block, new MouseEvent('click'));
  }
  function blockMenuDuplicate() {
    if (!blockContextMenu) return;
    vjClipLauncher.duplicateBlock(blockContextMenu.blockId);
    blockContextMenu = null;
  }
  function blockMenuDelete() {
    if (!blockContextMenu) return;
    if ($vjClipLauncher.blocks.length <= 1) { blockContextMenu = null; return; }
    if (confirm('Delete this block?')) {
      vjClipLauncher.deleteBlock(blockContextMenu.blockId);
    }
    blockContextMenu = null;
  }

  // Stage preset right-click — replaces the dangerous bare delete with a
  // proper menu offering Update / Rename / Delete.
  function openStageContextMenu(e: MouseEvent, preset: any) {
    e.preventDefault();
    stageContextMenu = { x: e.clientX, y: e.clientY, preset };
  }
  function closeStageContextMenu() { stageContextMenu = null; }

  function stageMenuUpdate() {
    if (!stageContextMenu) return;
    updateStagePresetInPlace(stageContextMenu.preset);
    stageContextMenu = null;
  }
  function stageMenuRename() {
    if (!stageContextMenu) return;
    const newName = prompt('Rename preset:', stageContextMenu.preset.name);
    if (newName && newName.trim()) {
      if (stageContextMenu.preset._scope === 'global') {
        globalStagePresets.rename(stageContextMenu.preset.id, newName.trim());
      } else {
        project.renameStagePreset(stageContextMenu.preset.id, newName.trim());
      }
    }
    stageContextMenu = null;
  }
  function stageMenuDelete() {
    if (!stageContextMenu) return;
    if (confirm(`Delete "${stageContextMenu.preset.name}"?`)) {
      deleteStagePreset(stageContextMenu.preset);
    }
    stageContextMenu = null;
  }
  function stageMenuSaveProject() {
    stageContextMenu = null;
    onFileAction?.('save');
  }

  // Block editing state
  let editingBlockId: string | null = null;
  let editingBlockName: string = '';
  let blockInputEl: HTMLInputElement | null = null;

  // Block drag-reorder state (VJ block tab strip)
  let draggedBlockIndex: number | null = null;
  let dragOverBlockIndex: number | null = null;

  // Preview canvas
  let previewCanvas: HTMLCanvasElement;
  let previewContainerEl: HTMLDivElement | null = null;
  // Full-native mode: the render core's output is shown by repositioning the
  // AppKit presenter underlay into our preview box (registered below) — the
  // 2D canvas blit only exists for the legacy browser renderer.
  const nativePreviewActive = isDesktopApp && NATIVE_ENGINE_ONLY;
  $: if (nativePreviewActive) {
    if ($vjClipLauncher.isOpen && previewContainerEl) {
      nativePreviewHostEl.set(previewContainerEl);
    } else if ($nativePreviewHostEl === previewContainerEl) {
      nativePreviewHostEl.set(null);
    }
  }
  let previewCtx: CanvasRenderingContext2D | null = null;
  let previewAnimationFrame: number | null = null;

  // ── Deck A/B confidence monitors (native split-deck mode) ──
  // Two named AppKit presenter views track these hole divs, fed by the
  // core's bank-monitor shared textures — no duplicate render, decode,
  // or readback. Geometry re-measures on a low-rate tick so layout,
  // resize, and panel changes are all picked up.
  let deckMonitorAEl: HTMLDivElement | null = null;
  let deckMonitorBEl: HTMLDivElement | null = null;
  let deckMonitorTimer: ReturnType<typeof setInterval> | null = null;
  let deckMonitorGeneration = 0;
  let deckMonitorLastSig = '';
  let deckMonitorsAttached = false;
  $: deckMonitorsVisible = nativePreviewActive
    && $vjClipLauncher.isOpen
    && $vjClipLauncher.crossfaderEnabled;

  function deckMonitorRect(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width,
      height,
      contentX: 0,
      contentY: 0,
      contentWidth: width,
      contentHeight: height,
      generation: ++deckMonitorGeneration,
    };
  }

  async function syncDeckMonitors() {
    if (!deckMonitorsVisible || !deckMonitorAEl?.isConnected || !deckMonitorBEl?.isConnected) {
      if (deckMonitorsAttached) {
        deckMonitorsAttached = false;
        deckMonitorLastSig = '';
        try { await invoke('deck_monitor_detach'); } catch { /* main may be gone */ }
      }
      return;
    }
    const rectA = deckMonitorRect(deckMonitorAEl);
    const rectB = deckMonitorRect(deckMonitorBEl);
    const sig = `${rectA.x}:${rectA.y}:${rectA.width}:${rectA.height}|${rectB.x}:${rectB.y}:${rectB.width}:${rectB.height}`;
    if (deckMonitorsAttached && sig === deckMonitorLastSig) return;
    try {
      const result = await invoke('deck_monitor_attach', {
        monitors: [
          { name: 'deck-a', rect: rectA },
          { name: 'deck-b', rect: rectB },
        ],
      }) as { attached?: boolean };
      deckMonitorsAttached = !!result?.attached;
      deckMonitorLastSig = deckMonitorsAttached ? sig : '';
    } catch {
      deckMonitorsAttached = false;
    }
  }

  $: if (nativePreviewActive && (deckMonitorsVisible || deckMonitorsAttached)) {
    if (!deckMonitorTimer) {
      deckMonitorTimer = setInterval(() => { void syncDeckMonitors(); }, 250);
    }
    // Re-measure promptly on visibility flips (the interval covers layout).
    setTimeout(() => { void syncDeckMonitors(); }, 0);
  } else if (deckMonitorTimer) {
    clearInterval(deckMonitorTimer);
    deckMonitorTimer = null;
  }

  // Resizable preview section
  let previewSectionHeight = 350;
  let isResizingPreview = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  // ─── VJ Video Controls State ───────────────────────────────────────
  // Mirrors LayerPanel.svelte's mapping-mode video controls. Refreshed
  // by a requestAnimationFrame tick whenever the active clip is a video,
  // so the timeline scrubber + time readout stay live without forcing
  // store updates 60×/sec.
  let vjVideoCurrentTime = 0;
  let vjVideoDuration = 0;
  let vjTrimDragging: 'start' | 'end' | null = null;
  let vjTimelineScrubbing = false;
  let vjTimelineEl: HTMLDivElement | null = null;
  let vjVideoTickFrame: number | null = null;

  function vjFormatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function vjClipDuration(clip: VJClip): number {
    const duration = Number(clip.durationSeconds ?? clip.videoElement?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function vjClipPlaybackTime(clip: VJClip, now = performance.now()): number {
    const duration = vjClipDuration(clip);
    const nativeTime = Number(clip._nativePlaybackTimeSeconds);
    const elementTime = Number(clip.videoElement?.currentTime);
    let time = Number.isFinite(nativeTime) && nativeTime >= 0
      ? nativeTime
      : Number.isFinite(elementTime) && elementTime >= 0
        ? elementTime
        : 0;
    const anchorMs = Number(clip._nativePlaybackUpdatedAtMs);
    if (clip.isPlaying !== false && Number.isFinite(anchorMs)) {
      time += Math.max(0, now - anchorMs) / 1000 * (Number(clip.playbackRate) || 1);
    }
    if (duration <= 0) return Math.max(0, time);
    const start = duration * Math.max(0, Math.min(1, clip.trimStart ?? 0));
    const end = duration * Math.max(0, Math.min(1, clip.trimEnd ?? 1));
    const range = Math.max(0.001, end - start);
    if ((clip.playbackMode ?? 'loop') !== 'once') {
      time = start + ((time - start) % range + range) % range;
    } else {
      time = Math.max(start, Math.min(end, time));
    }
    return time;
  }

  function vjSetNativePlaybackTime(layerIdx: number, clip: VJClip, time: number, play = clip.isPlaying !== false) {
    const duration = vjClipDuration(clip);
    const nextTime = Math.max(0, duration > 0 ? Math.min(duration, time) : time);
    if (clip.videoElement) {
      try { clip.videoElement.currentTime = nextTime; } catch { /* native transport remains authoritative */ }
    }
    vjVideoCurrentTime = nextTime;
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, {
      durationSeconds: duration || clip.durationSeconds,
      _nativePlaybackTimeSeconds: nextTime,
      _nativePlaybackUpdatedAtMs: performance.now(),
      _nativePlaybackSeekSeq: Math.max(0, clip._nativePlaybackSeekSeq ?? 0) + 1,
      isPlaying: play,
    }, paramDeck);
  }

  function startVjVideoTick() {
    if (vjVideoTickFrame !== null) return;
    function tick() {
      const clip = selectedLayerState?.activeClip;
      const v = clip?.videoElement;
      if (clip?.type === 'video') {
        vjVideoDuration = vjClipDuration(clip);
        if (!vjTimelineScrubbing) vjVideoCurrentTime = vjClipPlaybackTime(clip);
      } else if (v) {
        vjVideoCurrentTime = v.currentTime;
        vjVideoDuration = v.duration || 0;
      }
      vjVideoTickFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function stopVjVideoTick() {
    if (vjVideoTickFrame !== null) {
      cancelAnimationFrame(vjVideoTickFrame);
      vjVideoTickFrame = null;
    }
  }

  function vjSeekToPosition(e: MouseEvent, vEl: HTMLVideoElement) {
    if (!vjTimelineEl || !vEl) return;
    const rect = vjTimelineEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    // Clamp to the active trim region — Canvas.svelte's per-frame loop will
    // pull currentTime back to trimStart anyway if we seek outside, but
    // clamping at the input layer makes the playhead "stick" inside the
    // trim region the moment the user releases (no visual snap-back).
    const clip = selectedLayerState?.activeClip;
    const trimS = clip?.trimStart ?? 0;
    const trimE = clip?.trimEnd ?? 1;
    const clamped = Math.max(trimS, Math.min(trimE, pct));
    if (!clip || selectedLayerIndex === null) {
      vEl.currentTime = clamped * (vEl.duration || 0);
      return;
    }
    vjSetNativePlaybackTime(selectedLayerIndex, clip, clamped * vjClipDuration(clip));
  }

  function vjHandleTimelineMouseDown(e: MouseEvent, vEl: HTMLVideoElement) {
    if (!vjTimelineEl || !vEl) return;
    e.stopPropagation();
    vjTimelineScrubbing = true;
    vjSeekToPosition(e, vEl);
    const onMove = (me: MouseEvent) => vjSeekToPosition(me, vEl);
    const onUp = () => {
      vjTimelineScrubbing = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function vjHandleTrimMouseDown(e: MouseEvent, which: 'start' | 'end', layerIdx: number) {
    e.stopPropagation();
    e.preventDefault();
    vjTrimDragging = which;
    const onMove = (me: MouseEvent) => {
      if (!vjTimelineEl) return;
      const rect = vjTimelineEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / (rect.width || 1)));
      const clip = paramLayerStates[layerIdx]?.activeClip;
      if (!clip) return;
      const trimS = clip.trimStart ?? 0;
      const trimE = clip.trimEnd ?? 1;
      const updates: { trimStart?: number; trimEnd?: number } = {};
      if (which === 'start') updates.trimStart = Math.min(pct, trimE - 0.02);
      else updates.trimEnd = Math.max(pct, trimS + 0.02);
      vjClipLauncher.updateActiveClipVideoProps(layerIdx, updates, paramDeck);
    };
    const onUp = () => {
      vjTrimDragging = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function vjSetVideoPlaying(layerIdx: number, playing: boolean) {
    const clip = paramLayerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip || !v) return;
    const time = vjClipPlaybackTime(clip);
    if (playing) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, {
      isPlaying: playing,
      durationSeconds: vjClipDuration(clip) || clip.durationSeconds,
      _nativePlaybackTimeSeconds: time,
      _nativePlaybackUpdatedAtMs: performance.now(),
    }, paramDeck);
  }

  function vjRestartVideo(layerIdx: number) {
    const clip = paramLayerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip || !v) return;
    vjSetNativePlaybackTime(layerIdx, clip, (clip.trimStart ?? 0) * vjClipDuration(clip), true);
    v.play().catch(() => {});
  }

  function vjSetPlaybackRate(layerIdx: number, rate: number) {
    const clip = paramLayerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip) return;
    const time = vjClipPlaybackTime(clip);
    if (v) v.playbackRate = rate;
    // Picking a manual speed releases beat/bar sync (release parity).
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, {
      playbackRate: rate,
      playbackSyncBeats: null,
      durationSeconds: vjClipDuration(clip) || clip.durationSeconds,
      _nativePlaybackTimeSeconds: time,
      _nativePlaybackUpdatedAtMs: performance.now(),
    }, paramDeck);
  }

  function vjSetPlaybackSync(layerIdx: number, beats: number | null) {
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, { playbackSyncBeats: beats }, paramDeck);
  }

  /** Toggle opt-in audio for the selected clip.
   *
   *  The store does the real work (swapping the clip onto a dedicated,
   *  never-pooled element and attaching/detaching the clip audio bus). All
   *  that's needed here is to re-anchor the native transport so the audio
   *  element, which is about to appear or disappear, starts life on the same
   *  playhead the core is rendering — otherwise the first drift correction
   *  would be a hard seek from wherever the fresh element happened to load. */
  function vjSetClipAudioPlayback(layerIdx: number, enabled: boolean) {
    const clip = paramLayerStates[layerIdx]?.activeClip;
    if (!clip) return;
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, {
      audioPlayback: enabled,
      audioVolume: clip.audioVolume ?? 1,
      audioMuted: clip.audioMuted === true,
      durationSeconds: vjClipDuration(clip) || clip.durationSeconds,
      _nativePlaybackTimeSeconds: vjClipPlaybackTime(clip),
      _nativePlaybackUpdatedAtMs: performance.now(),
      _nativePlaybackSeekSeq: Math.max(0, clip._nativePlaybackSeekSeq ?? 0) + 1,
    }, paramDeck);
  }

  function vjSetPlaybackMode(layerIdx: number, mode: 'loop' | 'once') {
    const clip = paramLayerStates[layerIdx]?.activeClip;
    if (!clip) return;
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, {
      playbackMode: mode,
      durationSeconds: vjClipDuration(clip) || clip.durationSeconds,
      _nativePlaybackTimeSeconds: vjClipPlaybackTime(clip),
      _nativePlaybackUpdatedAtMs: performance.now(),
    }, paramDeck);
  }
  // ─── End VJ Video Controls ──────────────────────────────────────────

  function onPreviewResizeStart(e: PointerEvent) {
    isResizingPreview = true;
    resizeStartY = e.clientY;
    resizeStartHeight = previewSectionHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPreviewResizeMove(e: PointerEvent) {
    if (!isResizingPreview) return;
    const delta = e.clientY - resizeStartY;
    previewSectionHeight = Math.max(150, Math.min(800, resizeStartHeight + delta));
  }

  function onPreviewResizeEnd() {
    isResizingPreview = false;
  }

  // Resizable performer tray (drag top edge)
  let performerTopOverride: number | null = null;
  let isResizingPerformer = false;
  let performerResizeStartY = 0;
  let performerResizeStartTop = 0;

  $: performerTop = performerTopOverride ?? (previewSectionHeight + 56);

  function onPerformerResizeStart(e: PointerEvent) {
    isResizingPerformer = true;
    performerResizeStartY = e.clientY;
    performerResizeStartTop = performerTop;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPerformerResizeMove(e: PointerEvent) {
    if (!isResizingPerformer) return;
    const delta = e.clientY - performerResizeStartY;
    const minTop = 56; // don't go above the header bar
    const maxTop = window.innerHeight - 150; // leave at least 150px for performer
    performerTopOverride = Math.max(minTop, Math.min(maxTop, performerResizeStartTop + delta));
  }

  function onPerformerResizeEnd() {
    isResizingPerformer = false;
  }

  // Access the main output canvas via window (set by App.svelte)
  function getMainCanvas(): HTMLCanvasElement | null {
    return (window as any).__ghostarcadeOutputCanvas || null;
  }

  // Preview loop perf budget — controlled by Settings → Performance.
  // Defaults to full resolution at 60fps so capable machines look crisp;
  // users on weak hardware can downgrade either axis to free GPU budget.
  let _lastPreviewFrameTime = 0;

  // Start preview loop when VJ mode opens
  function startPreviewLoop() {
    if (previewAnimationFrame !== null) return;

    function updatePreview(now: number) {
      previewAnimationFrame = requestAnimationFrame(updatePreview);

      const perf = (get(settings) as any)?.performance;
      const fpsTarget = perf?.previewFrameRate ?? 60;
      const resCap = perf?.previewMaxDim ?? 0;
      const frameIntervalMs = 1000 / Math.max(1, fpsTarget);

      if (fpsTarget < 60 && now - _lastPreviewFrameTime < frameIntervalMs) return;
      _lastPreviewFrameTime = now;

      if (nativePreviewActive) return;
      const mainCanvas = getMainCanvas();
      if (!previewCanvas || !mainCanvas || !previewCtx) return;
      const srcW = mainCanvas.width;
      const srcH = mainCanvas.height;
      if (srcW === 0 || srcH === 0) return;

      const longEdge = Math.max(srcW, srcH);
      const scale = resCap > 0 && longEdge > resCap ? resCap / longEdge : 1;
      const dstW = Math.max(1, Math.round(srcW * scale));
      const dstH = Math.max(1, Math.round(srcH * scale));
      if (previewCanvas.width !== dstW || previewCanvas.height !== dstH) {
        previewCanvas.width = dstW;
        previewCanvas.height = dstH;
      }
      previewCtx.drawImage(mainCanvas, 0, 0, dstW, dstH);
    }
    previewAnimationFrame = requestAnimationFrame(updatePreview);
  }

  // Stop preview loop when VJ mode closes
  function stopPreviewLoop() {
    if (previewAnimationFrame !== null) {
      cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = null;
    }
  }

  // Watch for VJ mode open/close
  $: if ($vjClipLauncher.isOpen && previewCanvas) {
    previewCtx = previewCanvas.getContext('2d');
    startPreviewLoop();
  } else {
    stopPreviewLoop();
  }

  // Cleanup on destroy
  onDestroy(() => {
    if (deckMonitorTimer) {
      clearInterval(deckMonitorTimer);
      deckMonitorTimer = null;
    }
    if (deckMonitorsAttached) {
      deckMonitorsAttached = false;
      void invoke('deck_monitor_detach').catch(() => { /* main may be gone */ });
    }
    stopPreviewLoop();
    stopModGhostLoop();
    stopCrossfaderAutoLoop();
    stopCrossfaderGlide();
    stopVjVideoTick();
    vjStopNdiScan();
    stopAllVjLiveSources();
    window.removeEventListener('midi-stage-preset', stagePresetHandler);
    window.removeEventListener('vj-stage-effect-hold', stageEffectHoldHandler);
    releaseAllStageEffectHolds();
    if (vjRecorderHandle && vjIsRecording) {
      try { vjRecorderHandle.stop(); } catch {}
    }
  });

  // Blend modes
  const blendModes: BlendMode[] = [
    'normal',
    'add',
    'multiply',
    'screen',
    'overlay',
    'difference',
    'subtract',
    'darken',
    'lighten',
    'exclusion',
    'hardlight',
    'softlight',
    'color-dodge',
    'color-burn',
    'hue',
    'saturation',
    'color',
    'luminosity',
    'divide',
    'average',
    'negation',
    'phoenix',
    'linear-light',
    'hard-mix',
    'vivid-light',
    'pin-light',
  ];


  // Shader library
  interface ShaderItem {
    id: string;
    name: string;
    src: string;
    shaderCode: string;
    inputs: ISFInputDef[];
    values: Record<string, any>;
    thumbnail?: string;
  }

  let shaders: ShaderItem[] = [];
  let shadersLoading = true;

  // Recording state (shared recorder with audio support)
  let vjRecorderHandle: RecorderHandle | null = null;
  let vjIsRecording = false;
  let vjRecordingDuration = 0;

  function vjStartRecording() {
    vjRecordingDuration = 0;
    vjRecorderHandle = startRec({
      namePrefix: 'VJ Recording',
      onDurationUpdate: (s) => { vjRecordingDuration = s; },
      onComplete: () => { vjIsRecording = false; vjRecorderHandle = null; },
      onError: (err) => { alert('Failed to start recording: ' + err.message); },
    });
    if (vjRecorderHandle) {
      vjIsRecording = true;
    }
  }

  function vjStopRecording() {
    if (vjRecorderHandle) {
      vjRecorderHandle.stop();
      vjIsRecording = false;
      vjRecorderHandle = null;
    }
  }

  function formatVJRecordingDuration(seconds: number): string {
    return formatRecordingDuration(seconds);
  }

  type VJDragPayload = {
    type: 'shader' | 'video' | 'image' | 'threejs' | 'spout' | 'effect' | 'splat' | 'model3d' | 'gpu' | 'text' | 'preset' | 'live-source' | 'synthvision';
    id: string;
    spoutName?: string;
    pluginName?: string;
    effectType?: IntegratedEffectType;
  };

  type MediaTrayMediaPayload = {
    id: string;
    type: 'shader' | 'video' | 'image' | 'threejs' | 'p5js';
    name: string;
    src: string;
    thumbnail?: string;
    shaderCode?: string;
    shaderValues?: Record<string, any>;
    jsAnimation?: JSAnimationSource;
    _assetRef?: any;
  };

  type MediaTrayLiveSourcePayload = {
    id: string;
    type: 'live-source';
    sourceType: 'spout' | 'webcam' | 'capture' | 'ndi';
    name: string;
    status?: 'disconnected' | 'connecting' | 'live';
    stream?: MediaStream;
    videoEl?: HTMLVideoElement;
    thumbnail?: string;
    spoutSenderName?: string;
    ndiSourceName?: string;
  };

  type MediaTrayPluginPayload = {
    id: string;
    type: 'effect';
    name: string;
    pluginName?: string;
    src?: string;
    effectType?: IntegratedEffectType;
    effectSource?: IntegratedEffectSource;
  };

  type MediaTrayCreatorPayload = {
    id: 'gpu-shader' | 'text-creator' | 'performer';
    type: 'gpu' | 'text' | 'synthvision';
    name: string;
    src: 'gpu-layer' | 'text-layer' | 'performer';
  };

  type MediaTrayPresetPayload = {
    id: string;
    type: 'preset';
    name?: string;
  };

  type MediaTrayDropPayload = MediaTrayMediaPayload | MediaTrayLiveSourcePayload | MediaTrayPluginPayload | MediaTrayCreatorPayload | MediaTrayPresetPayload;

  // Drag state for clips
  let draggedClip: VJDragPayload | null = null;
  // Cells now carry a bank tag so cross-deck drag/drop works correctly when
  // the crossfader is on (drag from Bank A cell → Bank B cell, etc.)
  let dragOverCell: { layer: number; column: number; bank: VJDeck } | null = null;
  let dragSourceCell: { layer: number; column: number; bank: VJDeck } | null = null;
  type VJCellPress = {
    pointerId: number;
    layer: number;
    column: number;
    bank: VJDeck;
    startX: number;
    startY: number;
    moved: boolean;
  };
  let cellPress: VJCellPress | null = null;
  let cellDragInProgress = false;
  let lastPointerTriggerAt = -Infinity;
  const CELL_PRESS_SLOP_PX = 12;

  // Copy/paste state
  let clipboardClip: VJClip | null = null;
  let cellContextMenu: { x: number; y: number; layer: number; column: number; bank: VJDeck } | null = null;
  // Block-tab right-click context menu — gives quick access to "Save Project"
  // (overwrite the .gha file) plus the existing Rename / Duplicate / Delete
  // actions without forcing the user up to the File menu.
  let blockContextMenu: { x: number; y: number; blockId: string } | null = null;
  // Stage-preset right-click context menu — adds "Update Preset" so the user
  // can overwrite an existing preset with the current scene state instead
  // of having to delete and re-save.
  let stageContextMenu: { x: number; y: number; preset: any } | null = null;
  // Inline rename state for stage presets — double-click the name to
  // enter edit mode. Right-click → Rename still works (prompt-based);
  // this is the discoverable in-place path.
  let stageRenamingPresetId: string | null = null;
  let stageRenameValue = '';
  function startStageRename(preset: any, e: Event) {
    e.stopPropagation();
    stageRenamingPresetId = preset.id;
    stageRenameValue = preset.name;
  }
  function commitStageRename(preset: any) {
    const name = stageRenameValue.trim();
    if (name && name !== preset.name) {
      if (preset._scope === 'global') {
        globalStagePresets.rename(preset.id, name);
      } else {
        project.renameStagePreset(preset.id, name);
      }
    }
    stageRenamingPresetId = null;
    stageRenameValue = '';
  }
  function cancelStageRename() {
    stageRenamingPresetId = null;
    stageRenameValue = '';
  }
  /** Tiny Svelte action — focus + select the input on mount so the
   *  user can type immediately. Used by the inline rename input. */
  function focusOnMount(node: HTMLInputElement) {
    queueMicrotask(() => { node.focus(); node.select(); });
  }
  // Clip-preview panel state — opened from the cell context menu's Edit/Preview item.
  let previewPanel: { layer: number; column: number; clip: VJClip; bank: VJDeck } | null = null;

  // Drag state for layer reordering
  let draggedLayerIndex: number | null = null;
  let dragOverLayerIndex: number | null = null;

  // Selected layer for effects editing
  let selectedLayerIndex: number | null = null;
  // Keep vjClipLauncher store's selectedLayerIndex in sync so keyframe timeline can pick it up
  $: vjClipLauncher.setSelectedLayerIndex(selectedLayerIndex);

  // Media tab (matching mapping mode tabs)
  let vjMediaTab: 'shaders' | 'js' | 'library' | 'videos' | 'images' | 'sources' | 'plugins' | 'maps' = 'shaders';

  // When MAP sub-mode engages, force the media tray to the Maps tab.
  // (Other source tabs are hidden in MAP — landing on a hidden tab
  // would leave the tray blank.) When LEAVING MAP, if the user was
  // still pointed at Maps, fall back to Shaders since Maps is hidden
  // outside MAP mode.
  $: if ($vjClipLauncher.mapMode && vjMediaTab !== 'maps') {
    vjMediaTab = 'maps';
  }
  $: if (!$vjClipLauncher.mapMode && vjMediaTab === 'maps') {
    vjMediaTab = 'shaders';
  }

  // AI generator state
  let vjShowAIGenerator = false;
  let vjShowVideoGenerator = false;

  // Shader params overlay visibility
  let showShaderParams = true;

  // Get the current effects list based on the active effects tab.
  // Reads from the deck the parameter panel is currently following
  // (Bank A by default, Bank B when crossfader is on + selectedDeck === 'B').
  $: currentEffects = (() => {
    // Pull paramLayerStates / paramClipGrid as locals so Svelte tracks the
    // dependency on $vjClipLauncher properly.
    const _states = paramLayerStates;
    const _grid = paramClipGrid;
    if (effectsTab === 'composition') {
      return $vjClipLauncher.compositionEffects;
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return [];
      const activeCol = _states[selectedLayerIndex].activeColumn;
      if (activeCol === null) return [];
      const clip = _grid[selectedLayerIndex][activeCol];
      return clip?.effects || [];
    } else {
      // layer
      return selectedLayerState?.effects || [];
    }
  })();
  $: nativeInventoryLocked = NATIVE_ENGINE_ONLY && Boolean($settings.experimental?.outputNativeCore);

  function nativeEffectPending(effectType: EffectType | string): boolean {
    return nativeInventoryLocked && !isNativeSelectableEffect(effectType);
  }

  function toggleVJEffectIfNativeReady(effect: Effect) {
    if (nativeEffectPending(effect.type) && !effect.enabled) return;
    toggleEffect(effect.id);
  }

  // Get label for current effects tab context
  $: effectsTabLabel = (() => {
    const _states = paramLayerStates;
    const _grid = paramClipGrid;
    const deckTag = $vjClipLauncher.crossfaderEnabled ? ` (Deck ${paramDeck})` : '';
    if (effectsTab === 'composition') return 'COMPOSITION FX';
    if (effectsTab === 'led') return 'LED FX';
    if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return 'CLIP FX';
      const activeCol = _states[selectedLayerIndex].activeColumn;
      const clip = activeCol !== null ? _grid[selectedLayerIndex][activeCol] : null;
      return clip ? `CLIP: ${clip.name}${deckTag}` : 'CLIP FX';
    }
    return selectedLayerIndex !== null ? `LAYER ${selectedLayerIndex + 1} FX${deckTag}` : 'LAYER FX';
  })();

  // Track active clip ID to force shader params re-render when clip changes.
  $: activeClipId = selectedLayerIndex !== null ? paramLayerStates[selectedLayerIndex]?.activeClip?.id : null;
  // We no longer clear modulations on clip switch — modulations are
  // now keyed by clip ID (vjc:CLIPID:paramName) so they automatically
  // become inactive when the clip leaves the deck and resume when
  // the user re-fires it. That's the perform-ready behavior — set
  // a clip up with its automation once, trigger it whenever, the
  // automation just plays alongside without bleeding into other clips.
  // Base values are also keyed per-bank-per-layer-per-param so they
  // were never the right place for clip-switch invalidation anyway;
  // the per-clip mod path captures fresh base on each (re-)activation.
  let _prevActiveClipId: string | null = null;
  $: {
    if (activeClipId !== _prevActiveClipId) {
      _prevActiveClipId = activeClipId ?? null;
    }
  }
  // Force re-parse shader inputs when clip changes
  $: selectedClipShaderInputs = (() => {
    if (selectedLayerIndex === null) return [];
    // Reference activeClipId to make this reactive to clip changes
    void activeClipId;
    return getActiveShaderInputs(selectedLayerIndex);
  })();

  // Audio-ready badge: true if current shader uses audio uniforms
  $: clipIsAudioReady = (() => {
    if (selectedLayerIndex === null) return false;
    const clip = paramLayerStates[selectedLayerIndex]?.activeClip;
    return (clip as any)?._isAudioReady === true;
  })();

  // Saved items
  $: savedShaders = $shaderLibrary.shaders;
  $: savedVideos = $videoLibrary.videos;

  // --- Live Sources for VJ ---
  interface VJLiveSource {
    id: string;
    name: string;
    type: 'spout' | 'webcam' | 'capture' | 'ndi';
    spoutSenderName?: string;
    /** For NDI sources, the discovered sender name (used by the
     *  native addon's createReceiver). Spout uses the sender name
     *  directly in `name` so doesn't need this field. */
    ndiSourceName?: string;
    status: 'disconnected' | 'connecting' | 'live';
    stream?: MediaStream;
    videoEl?: HTMLVideoElement;
  }

  type VJScreenSource = ScreenCaptureSource;

  let vjLiveSources: VJLiveSource[] = [];
  let mediaTrayLiveSources: MediaTrayLiveSourcePayload[] = [];
  let vjScreenPickerOpen = false;
  let vjScreenPickerSources: VJScreenSource[] = [];
  let vjScreenPickerLoading = false;

  function disposeVjLiveSource(source: VJLiveSource) {
    try { source.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); } catch {}
    if (source.videoEl) {
      try { source.videoEl.pause(); } catch {}
      try { source.videoEl.srcObject = null; } catch {}
      try { source.videoEl.removeAttribute('src'); } catch {}
      try { source.videoEl.load(); } catch {}
    }
    // Native live-capture sessions must be released on the addon side too —
    // both webcam and screen sessions on Windows/macOS. Otherwise MF /
    // DesktopDuplication holds the device or the duplication open, which on
    // Windows blocks the next start of the same capture with an "already in
    // use" error.
    const nativeSessionId = (source as any).nativeSessionId;
    if (nativeSessionId && isDesktopApp) {
      void invoke('native_live_capture_stop', { sessionId: String(nativeSessionId) }).catch(() => {});
    }
  }

  function stopAllVjLiveSources() {
    for (const source of vjLiveSources) disposeVjLiveSource(source);
    vjLiveSources = [];
  }

  function closeVjScreenPicker() {
    vjScreenPickerOpen = false;
    vjScreenPickerSources = [];
    vjScreenPickerLoading = false;
  }

  function vjLiveSourceIconLabel(source: VJLiveSource): string {
    if (source.type === 'webcam') return 'CAM';
    if (source.type === 'capture') return 'SCR';
    if (source.type === 'ndi') return 'NDI';
    return getTextureShareLabel().slice(0, 3).toUpperCase();
  }

  function vjSpoutSenderName(source: VJLiveSource): string {
    return source.spoutSenderName
      || source.name.replace(`${getTextureShareLabel()}: `, '').replace('Spout: ', '').trim();
  }

  function createVJClipFromLiveSource(source: VJLiveSource): VJClip | null {
    const id = generateUUID();
    if (source.type === 'webcam' || source.type === 'capture') {
      // Under NATIVE_ENGINE_ONLY there is no browser videoEl — the capture
      // frames arrive as shared textures polled from win_capture_addon /
      // live_capture_addon. The sync recognises `live://webcam|capture/<id>`
      // and drives the addon via `native_live_capture_texture_info`, so a
      // missing videoEl is expected and must NOT block the clip.
      if (!source.videoEl && !isDesktopApp) return null;
      return {
        id,
        type: 'video',
        name: source.name,
        src: `live://${source.type}/${source.id}`,
        videoElement: source.videoEl,
        playbackMode: 'loop',
        isPlaying: true,
        mirrorX: source.type === 'webcam',
      };
    }

    if (source.type === 'spout') {
      const senderName = vjSpoutSenderName(source);
      if (!senderName) return null;
      return {
        id,
        type: 'spout',
        name: source.name,
        src: senderName,
        spoutSource: senderName,
      };
    }

    if (source.type === 'ndi') {
      const senderName = source.ndiSourceName?.trim();
      if (!senderName) return null;
      return {
        id,
        type: 'spout',
        name: source.name,
        src: senderName,
        ndiSource: {
          senderName,
          width: 1920,
          height: 1080,
        },
      };
    }

    return null;
  }

  function handleMediaTrayLiveSourcesChange(sources: MediaTrayLiveSourcePayload[]) {
    mediaTrayLiveSources = sources;
  }

  function windowMediaTrayLiveSources(): MediaTrayLiveSourcePayload[] {
    const sources = (window as any).__ghostVJMediaTrayLiveSources;
    return Array.isArray(sources) ? sources : [];
  }

  function findMediaTrayLiveSource(sourceId: string): MediaTrayLiveSourcePayload | null {
    return mediaTrayLiveSources.find((source) => source.id === sourceId)
      || windowMediaTrayLiveSources().find((source) => source.id === sourceId)
      || null;
  }

  function ensureMediaTrayLiveVideoElement(source: MediaTrayLiveSourcePayload): HTMLVideoElement | undefined {
    if (source.videoEl) return source.videoEl;
    if (!source.stream) return undefined;
    const videoEl = document.createElement('video');
    videoEl.srcObject = source.stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.play().catch(() => {});
    source.videoEl = videoEl;
    return videoEl;
  }

  function mediaTraySourceAsVJLiveSource(source: MediaTrayLiveSourcePayload): VJLiveSource {
    const videoEl = (source.sourceType === 'webcam' || source.sourceType === 'capture')
      ? ensureMediaTrayLiveVideoElement(source)
      : source.videoEl;
    return {
      id: source.id,
      name: source.name,
      type: source.sourceType,
      status: source.status ?? 'live',
      stream: source.stream,
      videoEl,
      spoutSenderName: source.spoutSenderName,
      ndiSourceName: source.ndiSourceName,
    };
  }

  function createVJClipFromMediaTrayLiveSource(source: MediaTrayLiveSourcePayload): VJClip | null {
    return createVJClipFromLiveSource(mediaTraySourceAsVJLiveSource(source));
  }

  function isMediaTrayLiveSourceInUse(sourceId: string): boolean {
    const source = findMediaTrayLiveSource(sourceId);
    const sourceType = source?.sourceType;
    const senderName = source?.spoutSenderName || source?.ndiSourceName || '';
    const candidates = new Set([
      `live://${sourceType ?? 'webcam'}/${sourceId}`,
      `live://webcam/${sourceId}`,
      `live://capture/${sourceId}`,
      `live://spout/${sourceId}`,
      `live://ndi/${sourceId}`,
      sourceId,
      senderName,
    ].filter(Boolean));

    const grids = [deckGrid('A'), deckGrid('B')];
    return grids.some((grid) => grid.some((row) => row.some((clip) => {
      if (!clip) return false;
      if (candidates.has(clip.src) || (clip.spoutSource && candidates.has(clip.spoutSource))) return true;
      if (clip.ndiSource?.senderName && candidates.has(clip.ndiSource.senderName)) return true;
      return false;
    })));
  }

  function activeVJDeckForAdd(): VJDeck {
    return $vjClipLauncher.crossfaderEnabled ? $vjClipLauncher.selectedDeck : 'A';
  }

  function findNextEmptyVJCell(bank: VJDeck): { layer: number; column: number } | null {
    const grid = deckGrid(bank);
    const startLayer = selectedLayerIndex ?? 0;
    const layerOrder = [
      startLayer,
      ...layerIndices.filter((idx) => idx !== startLayer),
    ];
    for (const layer of layerOrder) {
      for (const column of columnIndices) {
        if (!grid[layer]?.[column]) return { layer, column };
      }
    }
    return null;
  }

  function findNextEmptyVJColumn(layerIndex: number, bank: VJDeck): number | null {
    const row = deckGrid(bank)[layerIndex];
    if (!row) return null;
    for (const column of columnIndices) {
      if (!row[column]) return column;
    }
    return null;
  }

  function placeMediaTrayPayloadOnLayer(payload: MediaTrayDropPayload, layerIndex: number, bank: VJDeck): boolean {
    const column = findNextEmptyVJColumn(layerIndex, bank);
    if (column === null) {
      showToast('No empty slot on that VJ layer.', 'warning');
      return true;
    }

    const clip = createVJClipFromMediaTrayPayload(payload);
    if (!clip) {
      showToast('That source is not ready for the VJ deck yet.', 'warning');
      return true;
    }

    vjClipLauncher.setClip(layerIndex, column, clip, bank);
    selectedLayerIndex = layerIndex;
    showShaderParams = true;
    if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);
    return true;
  }

  function mediaTrayPayloadFromDataTransfer(dataTransfer: DataTransfer | null): MediaTrayDropPayload | null {
    const runtimePayload = (window as any).__ghostVJMediaTrayDragPayload as MediaTrayDropPayload | undefined;
    const raw = dataTransfer?.getData('application/x-ghost-media-source');
    if (!raw) {
      return runtimePayload && typeof runtimePayload.type === 'string' && typeof runtimePayload.id === 'string'
        ? runtimePayload
        : null;
    }
    try {
      const payload = JSON.parse(raw) as MediaTrayDropPayload;
      if (payload && typeof payload.type === 'string' && typeof payload.id === 'string') {
        if (payload.type === 'live-source' && runtimePayload?.type === 'live-source' && runtimePayload.id === payload.id) {
          return runtimePayload;
        }
        return payload;
      }
    } catch {
      return runtimePayload && typeof runtimePayload.type === 'string' && typeof runtimePayload.id === 'string'
        ? runtimePayload
        : null;
    }
    return runtimePayload && typeof runtimePayload.type === 'string' && typeof runtimePayload.id === 'string'
      ? runtimePayload
      : null;
  }

  function addLiveSourceToDeck(source: VJLiveSource, bank: VJDeck = activeVJDeckForAdd()) {
    const target = findNextEmptyVJCell(bank);
    const clip = createVJClipFromLiveSource(source);
    if (!target || !clip) return;
    vjClipLauncher.setClip(target.layer, target.column, clip, bank);
    selectedLayerIndex = target.layer;
    if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);
  }

  function addMediaTrayPayloadToDeck(payload: MediaTrayDropPayload, bank: VJDeck = activeVJDeckForAdd()) {
    const target = findNextEmptyVJCell(bank);
    if (!target) {
      showToast('No empty VJ deck slot available.', 'warning');
      return;
    }

    const clip = createVJClipFromMediaTrayPayload(payload);
    if (!clip) {
      showToast('That source is not ready for the VJ deck yet.', 'warning');
      return;
    }

    vjClipLauncher.setClip(target.layer, target.column, clip, bank);
    selectedLayerIndex = target.layer;
    showShaderParams = true;
    if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);
  }

  function handleLiveSourceDragStart(e: DragEvent, source: VJLiveSource) {
    if (source.status !== 'live') return;
    handleDragStart(e, { type: 'live-source', id: source.id, pluginName: source.name });
  }

  // NDI source discovery state. The native addon's findSources is
  // polled on an interval — the underlying NDIlib finder runs an
  // mDNS scan in the background and we just sample its current
  // result list. The 2s cadence is enough for users to notice when
  // a new sender comes online without flooding IPC.
  let vjDetectedNdiSources: { name: string; url: string }[] = [];
  let vjNdiScanInterval: ReturnType<typeof setInterval> | null = null;
  let vjNdiAvailable = false;
  let vjNdiChecked = false;
  let vjNdiScanning = false;
  let vjNdiStatusHint = 'Open an NDI® sender in MadMapper, Resolume, OBS, or another VJ app on this machine or network';
  async function vjStartNdiScan() {
    const api = (window as any).ghostNDI;
    if (!api) {
      vjNdiChecked = true;
      vjNdiAvailable = false;
      vjDetectedNdiSources = [];
      vjNdiStatusHint = 'NDI® is optional and not bundled in this build';
      return;
    }
    try {
      const avail = await api.available();
      vjNdiChecked = true;
      vjNdiAvailable = !!avail?.available;
      if (!vjNdiAvailable) {
        vjDetectedNdiSources = [];
        vjNdiStatusHint = avail?.error || 'Install NDI and restart Ghost Arcade';
      }
    } catch {
      vjNdiChecked = true;
      vjNdiAvailable = false;
      vjDetectedNdiSources = [];
      vjNdiStatusHint = 'Install NDI and restart Ghost Arcade';
    }
    if (!vjNdiAvailable) return;
    if (vjNdiScanInterval) return;
    const tick = async () => {
      vjNdiScanning = true;
      try {
        const found = await api.findSources();
        vjDetectedNdiSources = (Array.isArray(found) ? found : [])
          .map((src: any) => ({
            name: String(typeof src === 'string' ? src : src?.name || '').trim(),
            url: typeof src === 'object' && src?.url ? String(src.url) : '',
          }))
          .filter((src: { name: string }) => src.name.length > 0);
        vjNdiStatusHint = 'Open an NDI® sender in MadMapper, Resolume, OBS, or another VJ app on this machine or network';
      } catch (err) {
        vjNdiStatusHint = err instanceof Error ? err.message : String(err);
      } finally {
        vjNdiScanning = false;
      }
    };
    void tick();
    vjNdiScanInterval = setInterval(tick, 2000);
  }
  function vjStopNdiScan() {
    if (vjNdiScanInterval) { clearInterval(vjNdiScanInterval); vjNdiScanInterval = null; }
  }
  function vjAddNdiSource(sourceName: string) {
    const senderName = sourceName.trim();
    if (!senderName) return;
    const src: VJLiveSource = {
      id: crypto.randomUUID?.() || Date.now().toString(),
      name: `NDI: ${senderName}`,
      type: 'ndi',
      ndiSourceName: senderName,
      status: 'live',
    };
    vjLiveSources = [...vjLiveSources, src];
  }

  async function vjStartWebcam() {
    // Under NATIVE_ENGINE_ONLY the browser videoEl produced by getUserMedia
    // never reaches the compositor (WebGL renderer is disabled). Route
    // through the native live-capture addon instead — it publishes frames as
    // shared textures the render core imports directly.
    if (isDesktopApp) {
      try {
        const sessionId = (crypto.randomUUID?.() || Date.now().toString());
        const result = await invoke<{ ok?: boolean; error?: string }>(
          'native_live_capture_start_camera',
          { sessionId, deviceId: '' },
        );
        if (!result?.ok) throw new Error(result?.error || 'native camera did not start');
        vjLiveSources = [...vjLiveSources, {
          id: sessionId,
          name: 'Webcam',
          type: 'webcam',
          status: 'live',
          nativeSessionId: sessionId,
        } as any];
      } catch (err) {
        console.error('VJ native webcam start failed:', err);
        showToast((err as Error)?.message || 'Could not start camera.', 'error');
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Webcam';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();
      vjLiveSources = [...vjLiveSources, {
        id: crypto.randomUUID?.() || Date.now().toString(),
        name: label,
        type: 'webcam',
        status: 'live',
        stream,
        videoEl,
      }];
    } catch (err) {
      console.error('VJ webcam error:', err);
    }
  }

  async function vjStartCapture() {
    if (!screenCaptureSourcePickerAvailable()) return vjStartCaptureBrowserFallback();

    vjShowSpoutPicker = false;
    vjShowNdiPicker = false;
    vjScreenPickerOpen = true;
    vjScreenPickerLoading = true;
    vjScreenPickerSources = [];
    try {
      vjScreenPickerSources = await listScreenCaptureSources({ preferFast: true });
    } catch (err) {
      console.error('VJ capture source list error:', err);
      vjScreenPickerSources = [];
      showToast('Could not list screen capture sources.', 'error');
    } finally {
      vjScreenPickerLoading = false;
    }
  }

  async function vjPickScreenSource(picked: VJScreenSource) {
    closeVjScreenPicker();
    // Same reasoning as vjStartWebcam: the browser videoEl won't reach the
    // native compositor, so hand off to the native live-capture addon.
    if (isDesktopApp) {
      try {
        const sessionId = (crypto.randomUUID?.() || Date.now().toString());
        const result = await invoke<{ ok?: boolean; error?: string }>(
          'native_live_capture_start_screen',
          {
            sessionId,
            sourceId: picked.id,
            displayId: (picked as any).display_id || '',
            kind: (picked as any).kind || 'screen',
          },
        );
        if (!result?.ok) throw new Error(result?.error || 'native screen capture did not start');
        vjLiveSources = [...vjLiveSources, {
          id: sessionId,
          name: picked.name || 'Capture',
          type: 'capture',
          status: 'live',
          nativeSessionId: sessionId,
        } as any];
      } catch (err) {
        console.error('VJ native capture start failed:', err);
        showToast((err as Error)?.message || `Could not capture "${picked.name}".`, 'error');
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: picked.id,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 60,
          },
        } as any,
      });
      const videoTrack = stream.getVideoTracks()[0];
      const label = picked.name || videoTrack.label || 'Capture';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();
      const src: VJLiveSource = {
        id: crypto.randomUUID?.() || Date.now().toString(),
        name: label,
        type: 'capture',
        status: 'live',
        stream,
        videoEl,
      };
      videoTrack.onended = () => vjStopSource(src.id);
      vjLiveSources = [...vjLiveSources, src];
    } catch (err) {
      console.error('VJ capture source error:', err);
      showToast(`Could not capture "${picked.name}".`, 'error');
    }
  }

  async function vjStartCaptureBrowserFallback() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Screen Capture';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();
      const src: VJLiveSource = {
        id: generateUUID(),
        name: label,
        type: 'capture',
        status: 'live',
        stream,
        videoEl,
      };
      videoTrack.onended = () => vjStopSource(src.id);
      vjLiveSources = [...vjLiveSources, src];
    } catch (err) {
      if ((err as any).name !== 'AbortError') console.error('VJ capture fallback error:', err);
    }
  }

  let vjShowSpoutPicker = false;
  let vjShowNdiPicker = false;
  let vjSpoutInput = '';
  let vjDetectedSpoutSenders: string[] = [];
  let vjTextureShareAvailable = true;
  let vjTextureShareHint = `Open a ${getTextureShareLabel()} sender in MadMapper, Resolume, OBS, or another VJ app`;

  async function vjScanSpout() {
    const { invoke: bridgeInvoke, isDesktopApp } = await import('$lib/bridge');
    if (isDesktopApp) {
      try {
        const info = await bridgeInvoke<{
          label: string;
          available: boolean;
          error?: string | null;
        }>('texture_share_info');
        vjTextureShareAvailable = !!info.available;
        vjTextureShareHint = info.available
          ? `Open a ${info.label} sender in MadMapper, Resolume, OBS, or another VJ app`
          : (info.error || `${info.label} native addon unavailable`);
        if (!info.available) {
          vjDetectedSpoutSenders = [];
          return;
        }
        vjDetectedSpoutSenders = await bridgeInvoke('spout_list_senders');
      } catch (err) {
        console.warn('VJ Spout scan failed:', err);
        vjTextureShareAvailable = false;
        vjTextureShareHint = err instanceof Error ? err.message : String(err);
        vjDetectedSpoutSenders = [];
      }
    } else {
      vjDetectedSpoutSenders = [];
    }
  }

  function vjAddSpoutInput(name: string) {
    const src: VJLiveSource = {
      id: crypto.randomUUID?.() || Date.now().toString(),
      name: `${getTextureShareLabel()}: ${name}`,
      type: 'spout',
      spoutSenderName: name,
      status: 'connecting',
    };
    vjLiveSources = [...vjLiveSources, src];
    setTimeout(() => {
      vjLiveSources = vjLiveSources.map(s =>
        s.id === src.id ? { ...s, status: 'live' as const } : s
      );
    }, 1500);
  }

  function vjStopSource(id: string) {
    const s = vjLiveSources.find(s => s.id === id);
    if (s) disposeVjLiveSource(s);
    vjLiveSources = vjLiveSources.filter(s => s.id !== id);
  }

  // Three.js items (built-in)
  interface ThreeJSItem {
    id: string;
    name: string;
    src: string;
    thumbnail?: string;
  }

  const bundledVJThreeJSItems: Array<{ id: string; folder: string; name: string; url: string }> =
    bundledThreeJSItems as any;

  // Default JS animation items that ship with every build. This mirrors
  // MediaTray's virtual:threejs-bundles catalog so VJ sees the same built-ins.
  const fallbackThreeJSItems: ThreeJSItem[] = [
    {
      id: 'threejs-embryo',
      name: 'Embryo',
      src: '/threejs/embryo/index.html',
      thumbnail: undefined,
    },
  ];

  const defaultThreeJSItems: ThreeJSItem[] =
    bundledVJThreeJSItems.length > 0
      ? bundledVJThreeJSItems.map((def) => ({
          id: def.id,
          name: def.name,
          src: def.url,
          thumbnail: undefined,
        }))
      : fallbackThreeJSItems;

  let threejsItems: ThreeJSItem[] = [...defaultThreeJSItems];

  // Generate thumbnail from Three.js iframe
  async function generateThreeJSThumbnail(src: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position: absolute; left: -9999px; top: -9999px; width: 320px; height: 180px; border: none;';
      iframe.src = src;
      document.body.appendChild(iframe);

      // Give it time to render
      setTimeout(() => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeCanvas = iframeDoc.querySelector('canvas');
            if (iframeCanvas) {
              const thumbCanvas = document.createElement('canvas');
              thumbCanvas.width = 160;
              thumbCanvas.height = 90;
              const ctx = thumbCanvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(iframeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
                resolve(thumbCanvas.toDataURL('image/jpeg', 0.7));
              } else {
                resolve(undefined);
              }
            } else {
              resolve(undefined);
            }
          } else {
            resolve(undefined);
          }
        } catch (err) {
          // Cross-origin or other error
          console.warn('Could not generate Three.js thumbnail:', err);
          resolve(undefined);
        } finally {
          document.body.removeChild(iframe);
        }
      }, 2000); // Wait 2 seconds for Three.js to render
    });
  }

  // Load shaders on mount
  onMount(() => {
    // Start the NDI source scan loop. Polls findSources() every 2s
    // so the Sources tab reflects new senders as they come/go on the
    // network. No-ops cleanly when NDI isn't available.
    void vjStartNdiScan();

    window.addEventListener('midi-stage-preset', stagePresetHandler);
    window.addEventListener('vj-stage-effect-hold', stageEffectHoldHandler);

    const init = async () => {
      try {
        const response = await fetch('./ISF/manifest.json');
        const manifest = await response.json();

        const loadedShaders: ShaderItem[] = [];

        // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
        const entries: Array<{ file: string; defaults?: Record<string, any> }> =
          manifest.version === 2
            ? manifest.shaders.filter((s: any) => s.enabled !== false)
            : manifest.shaders.map((f: string) => ({ file: f }));

        for (const entry of entries) {
          const filename = entry.file;
          try {
            const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
            const shaderResponse = await fetch(`./ISF/${encodedPath}`);
            const shaderCode = await shaderResponse.text();
            const parsed = parseISF(shaderCode);

            const shaderItem: ShaderItem = {
              id: generateUUID(),
              name: filename.replace('.fs', '').replace('DM-', ''),
              src: `./ISF/${encodedPath}`,
              shaderCode,
              inputs: parsed.metadata.INPUTS as ISFInputDef[],
              values: {},
            };

            for (const input of shaderItem.inputs) {
              if (input.TYPE !== 'image') {
                // Apply manifest default overrides if present
                const manifestDefault = entry.defaults?.[input.NAME];
                shaderItem.values[input.NAME] = manifestDefault !== undefined
                  ? manifestDefault
                  : getInputDefault(input);
              }
            }

            loadedShaders.push(shaderItem);
          } catch (err) {
            console.warn(`Failed to load shader ${filename}:`, err);
          }
        }

        shaders = loadedShaders;
        shadersLoading = false;

        // Generate shader thumbnails in background
        for (const shader of shaders) {
          try {
            shader.thumbnail = await generateShaderThumbnail(shader.shaderCode, 0.5);
            shaders = [...shaders];
          } catch (err) {}
        }

        // Generate Three.js thumbnails in background
        for (let i = 0; i < threejsItems.length; i++) {
          const item = threejsItems[i];
          if (!item.thumbnail) {
            try {
              const thumbnail = await generateThreeJSThumbnail(item.src);
              if (thumbnail) {
                threejsItems[i] = { ...item, thumbnail };
                threejsItems = [...threejsItems]; // Trigger reactivity
              }
            } catch (err) {}
          }
        }
      } catch (err) {
        console.error('Failed to load shaders:', err);
        shadersLoading = false;
      }
    };

    init();

    // Listen for MIDI macro events (dispatched by midiRouter for component-local macro state)
    const handleMidiMacro = (e: Event) => {
      const { macro, value } = (e as CustomEvent).detail;
      if (macro === 1) onVJMacro1Change(value);
      else if (macro === 2) onVJMacro2Change(value);
    };
    window.addEventListener('midi-vj-macro', handleMidiMacro);

    return () => {
      window.removeEventListener('midi-vj-macro', handleMidiMacro);
    };
  });

  // === Audio State ===
  // Audio source orchestration moved into AudioInputPicker.svelte (single
  // source of truth across mapping / VJ / Performer modes). VJAudioBar still
  // accepts a setAudioSource prop for backward compat (it's not rendered
  // here anymore — see header above), so we keep this thin shim wired to
  // the same store calls.
  async function setAudioSource(source: 'none' | 'microphone' | 'system') {
    if (source === 'none') {
      await audioStore.stop();
    } else if (source === 'microphone') {
      await audioStore.stop();
      await audioStore.startMicrophone();
    } else if (source === 'system') {
      await audioStore.stop();
      await audioStore.startSystemAudio();
    }
  }
  // Suppress unused-function warning since the strip that called this is gone.
  void setAudioSource;

  function handleTapTempo() {
    audioStore.tapTempo();
  }

  function clearTapTempo() {
    audioStore.clearManualBPM();
  }

  // Close VJ mode
  function closeVJMode() {
    console.log('[VJPanel] closeVJMode: start');
    closeVjScreenPicker();

    // First make the workspace and renderer leave VJ. Cleanup below is
    // best-effort; it must never leave the overlay visible or VJ output live.
    try { vjClipLauncher.stopAll(); } catch (err) { console.warn('[VJPanel] stopAll failed during close:', err); }
    try { vjClipLauncher.setLive(false); } catch (err) { console.warn('[VJPanel] setLive(false) failed during close:', err); }
    try { vjClipLauncher.setOpen(false, { fromWorkspace: true }); } catch (err) { console.warn('[VJPanel] setOpen(false) failed during close:', err); }
    try { workspace.closeAll(); } catch (err) { console.warn('[VJPanel] workspace close failed during close:', err); }

    try { modulationEngine.stop(); } catch (err) { console.warn('[VJPanel] modulation stop failed:', err); }
    try { performanceStore.stop(); } catch (err) { console.warn('[VJPanel] performance stop failed:', err); }
    try { releaseAllStageEffectHolds(); } catch (err) { console.warn('[VJPanel] stage effect hold cleanup failed:', err); }
    try { stopAllVjLiveSources(); } catch (err) { console.warn('[VJPanel] live source cleanup failed:', err); }
    try { vjClipLauncher.clearRuntimeSourceCache(); } catch (err) { console.warn('[VJPanel] runtime source cache cleanup failed:', err); }
    try {
      // Clear synthvision clips after VJ is no longer live so stale
      // performer textures cannot keep feeding the renderer.
      vjClipLauncher.clearSynthVisionClips();
      console.log('[VJPanel] closeVJMode: synthvision clips cleared');
    } catch (err) {
      console.warn('[VJPanel] synthvision cleanup failed:', err);
    }
    showPerformer = false;
    performerStarted = false;
    console.log('[VJPanel] closeVJMode: performer destroyed');
    console.log('[VJPanel] closeVJMode: VJ closed');
  }

  function handleExitVJClick(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    closeVJMode();
  }

  // === Shader Parameter Controls ===
  // Cache parsed ISF inputs per shader code hash to avoid re-parsing every frame
  let cachedShaderInputs: Map<string, ISFInput[]> = new Map();

  function getActiveShaderInputs(layerIndex: number): ISFInput[] {
    // Reads from whichever deck the parameter panel is following — Bank A
    // by default, Bank B when crossfader is on + selectedDeck === 'B'.
    const clip = paramLayerStates[layerIndex]?.activeClip;
    if (!clip || clip.type !== 'shader' || !clip.shaderCode) return [];

    // Use clip ID + first 64 chars as cache key to distinguish different shaders
    const cacheKey = clip.id + ':' + clip.shaderCode.substring(0, 64);
    if (cachedShaderInputs.has(cacheKey)) {
      const cached = cachedShaderInputs.get(cacheKey)!;
      // Re-register param ranges every time so they stay fresh after
      // shader / mode switches. Namespace under the CLIP ID so
      // mapping-mode ranges or other VJ shaders can't clobber this
      // shader's range entries on mode switch.
      registerParamRanges(layerIndex, cached, 'vj', clip.id);
      return cached;
    }

    // Parse the ISF metadata from shader code
    try {
      const parsed = parseISF(clip.shaderCode);
      const inputs = parsed.metadata.INPUTS.filter(
        i => i.TYPE !== 'image' && i.TYPE !== 'audio' && i.TYPE !== 'audioFFT'
      );
      cachedShaderInputs.set(cacheKey, inputs);
      // Register param ranges in the per-clip namespace.
      registerParamRanges(layerIndex, inputs, 'vj', clip.id);
      // Ensure all float/long params have their DEFAULT written to shaderValues
      // so modulation can find a base value even if the user hasn't moved the slider
      for (const inp of inputs) {
        if ((inp.TYPE === 'float' || inp.TYPE === 'long') && inp.DEFAULT !== undefined) {
          const current = clip.shaderValues?.[inp.NAME];
          if (current === undefined) {
            vjClipLauncher.updateActiveClipShaderValue(layerIndex, inp.NAME, inp.DEFAULT as number);
          }
        }
      }
      // Store audio-ready flag on the clip for UI badges
      if (clip.shaderCode) {
        (clip as any)._isAudioReady = parsed.isAudioReady;
      }
      return inputs;
    } catch {
      return [];
    }
  }

  function getShaderParamValue(layerIndex: number, paramName: string, defaultValue: number): number {
    // Reads from the deck the parameter panel is following.
    const clip = paramLayerStates[layerIndex]?.activeClip;
    if (!clip || !clip.shaderValues) return defaultValue;
    const val = clip.shaderValues[paramName];
    return typeof val === 'number' ? val : defaultValue;
  }

  function setShaderParamValue(layerIndex: number, paramName: string, value: number) {
    vjClipLauncher.updateActiveClipShaderValue(layerIndex, paramName, value, paramDeck);
    setBaseValue(layerIndex, paramName, value); // Keep modulation base in sync with slider
  }

  function setJSAnimationParamValue(
    layerIndex: number,
    paramName: string,
    value: number | boolean | number[]
  ) {
    vjClipLauncher.updateActiveClipJSAnimationParam(layerIndex, paramName, value, paramDeck);
  }

  function jsAnimationColorHex(value: unknown): string {
    if (!Array.isArray(value) || value.length < 3) return '#ffffff';
    const channels = value.slice(0, 3).map((channel) => {
      const numeric = Number(channel);
      const byte = numeric <= 1 ? numeric * 255 : numeric;
      return Math.max(0, Math.min(255, Math.round(byte))).toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`;
  }

  function jsAnimationColorValue(hex: string): number[] {
    const normalized = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
    return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  }

  /** Reset every shader input on the currently-open shader-params
   *  panel back to the values the curator saved — the per-shader
   *  manifest defaults. Falls back to INPUT.DEFAULT (the ISF
   *  metadata baseline) when the curator hasn't set an override
   *  for a given param. Also clears any active audio / auto
   *  modulation so the engine doesn't immediately overwrite the
   *  values we just snapped back; without that, the visible
   *  slider would bounce right back to wherever the playhead /
   *  audio is driving it. */
  function resetShaderParamsToDefaults() {
    if (selectedLayerIndex === null) return;
    const activeClip = selectedLayerState?.activeClip;
    // Locate the manifest entry for this clip's shader so we can
    // read the curator defaults out of its `values` map. The
    // shader library's loaded items have `values` already merged
    // from manifest.defaults + INPUT.DEFAULT at load time.
    const libraryEntry = activeClip
      ? shaders.find(s => s.src === activeClip.src)
        ?? shaders.find(s => s.shaderCode === activeClip.shaderCode)
      : undefined;
    for (const input of selectedClipShaderInputs) {
      // Clear modulations on BOTH the per-clip and legacy layer
      // keys so reset wipes everything regardless of which path
      // the original binding used.
      if (activeClipId) {
        const m = modulationStore.getModulation(selectedLayerIndex, input.NAME, paramDeck, 'vj', activeClipId);
        if (m && m.source !== 'manual') {
          setParamModSource(selectedLayerIndex, input.NAME, 'manual', paramDeck, 'vj', activeClipId);
        }
      }
      const existingMod = modulationStore.getModulation(selectedLayerIndex, input.NAME, paramDeck);
      if (existingMod && existingMod.source !== 'manual') {
        setParamModSource(selectedLayerIndex, input.NAME, 'manual', paramDeck);
      }
      // Drop any Auto sidecar on the clip so the playhead stops
      // overriding the value we're about to restore to defaults.
      if (activeClipId && getShaderAuto(input.NAME)) {
        vjClipLauncher.setClipShaderValueAuto(activeClipId, input.NAME, null);
      }
      // Prefer curator-saved value from the library entry; fall
      // through to INPUT.DEFAULT for params the curator didn't
      // explicitly override.
      let target: number | boolean | undefined;
      const curatorVal = libraryEntry?.values?.[input.NAME];
      if (typeof curatorVal === 'number' || typeof curatorVal === 'boolean') {
        target = curatorVal;
      } else if (input.DEFAULT !== undefined && input.DEFAULT !== null) {
        if (typeof input.DEFAULT === 'number' || typeof input.DEFAULT === 'boolean') {
          target = input.DEFAULT;
        }
      }
      if (target === undefined) continue;
      const numeric = typeof target === 'boolean' ? (target ? 1 : 0) : target;
      setShaderParamValue(selectedLayerIndex, input.NAME, numeric);
    }
  }

  // Subscribe reactively to the modulation store so the
  // shader-params panel re-renders when the user picks a new
  // source. getParamModulation READS DIRECTLY from this reactive
  // value (not via modulationStore.getModulation which does a
  // snapshot read) — that's the only way Svelte's template
  // reactivity sees the call as dependent on the store. Earlier
  // rev did `void modulationMap` inside the function which DID
  // re-run the assignment but the template uses
  // getParamModulation() not modulationMap, and Svelte doesn't
  // trace dependencies through function calls.
  $: modulationMap = $modulationStore;

  // Modulation helpers — read directly from the reactive map so
  // Svelte tracks each call site (in {@const mod = ...}) as
  // dependent on the store. Mods are layer-keyed (same model as
  // mapping mode): the modulation lives on the deck layer and
  // applies to whichever clip is currently active there.
  function getParamModulation(layerIndex: number, paramName: string): ParamModulation | undefined {
    return modulationMap.get(modKeyShader(layerIndex, paramName, paramDeck));
  }

  /** Read the live Auto config for a shader param on the active clip.
   *  Reads through the reactive vjLauncherState so Svelte tracks the
   *  dependency from template `{@const}` sites. */
  function getShaderAuto(paramName: string): AutoConfig | undefined {
    if (selectedLayerIndex === null) return undefined;
    const ls = paramLayerStates[selectedLayerIndex];
    return ls?.activeClip?.shaderValueAuto?.[paramName];
  }

  /** Update one field on a shader param's Auto config. Writes through
   *  vjClipLauncher.setClipShaderValueAuto so the change rides with
   *  the clip — survives clip-grid moves, deck swaps, project saves. */
  function setShaderAutoField<K extends keyof AutoConfig>(
    paramName: string,
    field: K,
    value: AutoConfig[K],
  ) {
    if (!activeClipId) return;
    const cur = getShaderAuto(paramName);
    if (!cur) return;
    vjClipLauncher.setClipShaderValueAuto(activeClipId, paramName, { ...cur, [field]: value });
  }

  /** Replacement for setParamModSource that knows about the new
   *  Auto-as-sidecar architecture. Auto goes to the clip's
   *  shaderValueAuto; everything else continues through the audio
   *  modulation store. Switching between auto and audio-source
   *  clears the OTHER path to keep them mutually exclusive. */
  function setShaderParamSource(layerIndex: number, paramName: string, source: ModSource, paramMin: number, paramMax: number) {
    if (source === 'auto') {
      // Clear any audio modulation for this param.
      const mClip = activeClipId ? modulationStore.getModulation(layerIndex, paramName, paramDeck, 'vj', activeClipId) : undefined;
      if (mClip && mClip.source !== 'manual' && activeClipId) {
        setParamModSource(layerIndex, paramName, 'manual', paramDeck, 'vj', activeClipId);
      }
      const mLayer = modulationStore.getModulation(layerIndex, paramName, paramDeck);
      if (mLayer && mLayer.source !== 'manual') {
        setParamModSource(layerIndex, paramName, 'manual', paramDeck);
      }
      // Seed sidecar (or reuse if user is just toggling back).
      if (activeClipId) {
        const existing = getShaderAuto(paramName) ?? defaultAutoFor(paramMin, paramMax);
        vjClipLauncher.setClipShaderValueAuto(activeClipId, paramName, existing);
      }
      return;
    }
    // Switching away from Auto — clear the sidecar.
    if (activeClipId && getShaderAuto(paramName)) {
      vjClipLauncher.setClipShaderValueAuto(activeClipId, paramName, null);
    }
    // Delegate to the audio modulation path.
    setParamModSource(layerIndex, paramName, source, paramDeck, 'vj', activeClipId ?? undefined);
  }

  // ── Mod tray (anchored popover owning all modulation tuning) ──────
  // One tray instance for the whole shader-params panel; opens against
  // the clicked param's chip. Replaces the old inline source <select> +
  // Depth/Speed rows (whose writes were silently dropped — they looked
  // the mod up by layer key while the mod was stored clip-keyed).
  let modTrayParam: string | null = null;
  let modTrayAnchor: HTMLElement | null = null;

  function toggleModTray(paramName: string, anchor: HTMLElement) {
    if (modTrayParam === paramName) {
      modTrayParam = null;
    } else {
      modTrayParam = paramName;
      modTrayAnchor = anchor;
    }
  }

  /** Patch the param's modulation wherever it actually lives —
   *  clip-keyed (vjc:) when present, legacy layer-keyed otherwise. */
  function patchShaderMod(paramName: string, patch: Partial<ParamModulation>) {
    if (selectedLayerIndex === null) return;
    const keyClip = activeClipId ? modKeyShader(selectedLayerIndex, paramName, paramDeck, 'vj', activeClipId) : null;
    if (keyClip && modulationMap.has(keyClip)) {
      updateParamMod(selectedLayerIndex, paramName, patch, paramDeck, 'vj', activeClipId!);
    } else {
      updateParamMod(selectedLayerIndex, paramName, patch, paramDeck, 'vj');
    }
  }

  function patchShaderAuto(paramName: string, patch: Partial<AutoConfig>) {
    if (!activeClipId) return;
    const cur = getShaderAuto(paramName);
    if (!cur) return;
    vjClipLauncher.setClipShaderValueAuto(activeClipId, paramName, { ...cur, ...patch });
  }

  // A/B crossfader modulation. Audio/LFO/sync use the shared
  // modulation engine target; Auto is a tiny local playhead because
  // the global fader is not a clip/layer param with an Auto sidecar.
  let crossfaderModTrayAnchor: HTMLElement | null = null;
  let crossfaderMod: ParamModulation | undefined;
  let crossfaderCurrentSource: ModSource = 'manual';
  let crossfaderModActive = false;
  let crossfaderAuto: AutoConfig | undefined = undefined;
  let crossfaderAutoRaf: number | null = null;
  let crossfaderAutoLastTime = 0;
  let crossfaderGlideRaf: number | null = null;

  $: crossfaderMod = modulationMap.get(MOD_KEY_XFADE_VALUE);
  $: crossfaderCurrentSource = crossfaderAuto ? 'auto' : (crossfaderMod?.source ?? 'manual');
  $: crossfaderModActive = crossfaderCurrentSource !== 'manual';

  function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  function resolveCrossfaderAutoValue(auto: AutoConfig): number {
    const phase = Number.isFinite(auto.phase) ? auto.phase : 0;
    const shaped = auto.mode === 'pingpong'
      ? (phase < 0.5 ? phase * 2 : 2 - phase * 2)
      : phase;
    const min = clamp01(auto.min);
    const max = clamp01(auto.max);
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return clamp01(lo + shaped * (hi - lo));
  }

  function tickCrossfaderAuto(now: number) {
    if (!crossfaderAuto) {
      crossfaderAutoRaf = null;
      crossfaderAutoLastTime = 0;
      return;
    }
    crossfaderAutoRaf = requestAnimationFrame(tickCrossfaderAuto);
    const dt = crossfaderAutoLastTime === 0 ? 0 : (now - crossfaderAutoLastTime) / 1000;
    crossfaderAutoLastTime = now;
    if (!$vjClipLauncher.crossfaderEnabled || !crossfaderAuto.playing || dt <= 0 || dt > 0.1) return;

    const speedHz = Number.isFinite(crossfaderAuto.speedHz) ? crossfaderAuto.speedHz : 0.15;
    const prev = Number.isFinite(crossfaderAuto.phase) ? crossfaderAuto.phase : 0;
    const next = (prev + speedHz * dt) % 1;
    crossfaderAuto.phase = next < 0 ? next + 1 : next;
    vjClipLauncher.setCrossfaderValue(resolveCrossfaderAutoValue(crossfaderAuto));
  }

  function startCrossfaderAutoLoop() {
    if (crossfaderAutoRaf !== null || !crossfaderAuto) return;
    crossfaderAutoLastTime = 0;
    crossfaderAutoRaf = requestAnimationFrame(tickCrossfaderAuto);
  }

  function stopCrossfaderAutoLoop() {
    if (crossfaderAutoRaf !== null) {
      cancelAnimationFrame(crossfaderAutoRaf);
      crossfaderAutoRaf = null;
    }
    crossfaderAutoLastTime = 0;
  }

  function stopCrossfaderGlide() {
    if (crossfaderGlideRaf !== null) {
      cancelAnimationFrame(crossfaderGlideRaf);
      crossfaderGlideRaf = null;
    }
  }

  function toggleCrossfaderModTray(anchor: HTMLElement) {
    crossfaderModTrayAnchor = crossfaderModTrayAnchor === anchor ? null : anchor;
  }

  function setCrossfaderSource(source: ModSource) {
    if (source === 'auto') {
      setCrossfaderModSource('manual');
      crossfaderAuto = crossfaderAuto ?? defaultAutoFor(0, 1);
      vjClipLauncher.setCrossfaderValue(resolveCrossfaderAutoValue(crossfaderAuto));
      startCrossfaderAutoLoop();
      return;
    }
    crossfaderAuto = undefined;
    stopCrossfaderAutoLoop();
    setCrossfaderModSource(source);
  }

  function patchCrossfaderMod(patch: Partial<ParamModulation>) {
    const cur = modulationStore.getCrossfaderModulation();
    if (!cur) return;
    modulationStore.setCrossfaderModulation({ ...cur, ...patch });
    if (cur.source !== 'manual' && !modulationEngine.running) modulationEngine.start();
  }

  function patchCrossfaderAuto(patch: Partial<AutoConfig>) {
    const cur = crossfaderAuto ?? defaultAutoFor(0, 1);
    const next = { ...cur, ...patch };
    const min = clamp01(next.min);
    const max = clamp01(next.max);
    crossfaderAuto = {
      ...next,
      min: Math.min(min, max),
      max: Math.max(min, max),
    };
    if (crossfaderAuto.playing) {
      startCrossfaderAutoLoop();
    } else {
      stopCrossfaderAutoLoop();
    }
  }

  function setCrossfaderManualValue(value: number) {
    stopCrossfaderGlide();
    if (crossfaderCurrentSource !== 'manual') {
      crossfaderAuto = undefined;
      stopCrossfaderAutoLoop();
      setCrossfaderModSource('manual');
    }
    vjClipLauncher.setCrossfaderValue(clamp01(value));
  }

  function glideCrossfaderTo(target: number) {
    stopCrossfaderGlide();
    if (crossfaderCurrentSource !== 'manual') {
      crossfaderAuto = undefined;
      stopCrossfaderAutoLoop();
      setCrossfaderModSource('manual');
    }

    const start = clamp01($vjClipLauncher.crossfaderValue);
    const end = clamp01(target);
    const durationSec = Math.max(0, Math.min(8, $vjClipLauncher.crossfaderFadeDuration ?? 0));
    if (durationSec <= 0 || Math.abs(start - end) < 0.0005) {
      vjClipLauncher.setCrossfaderValue(end);
      return;
    }

    const started = performance.now();
    const ease = (t: number) => {
      const c = Math.max(0, Math.min(1, t));
      return c * c * (3 - 2 * c);
    };
    const tick = (now: number) => {
      const t = ease((now - started) / (durationSec * 1000));
      vjClipLauncher.setCrossfaderValue(start + (end - start) * t);
      if (t < 1) {
        crossfaderGlideRaf = requestAnimationFrame(tick);
      } else {
        crossfaderGlideRaf = null;
      }
    };
    crossfaderGlideRaf = requestAnimationFrame(tick);
  }

  $: if (!$vjClipLauncher.crossfaderEnabled) {
    crossfaderModTrayAnchor = null;
    stopCrossfaderAutoLoop();
    stopCrossfaderGlide();
  }
  $: if ($vjClipLauncher.crossfaderEnabled && crossfaderAuto?.playing) {
    startCrossfaderAutoLoop();
  }

  // Close the tray when the params panel goes away.
  $: if (!showShaderParams || selectedLayerIndex === null) modTrayParam = null;

  // Live modulated values for ghost indicator on sliders
  let modGhostValues: Record<string, number> = {};
  let modGhostRaf: number | null = null;

  function startModGhostLoop() {
    if (modGhostRaf !== null) return;
    const tick = () => {
      if (selectedLayerIndex === null || !showShaderParams) {
        modGhostValues = {};
        modGhostRaf = null;
        return;
      }
      const newVals: Record<string, number> = {};
      for (const input of selectedClipShaderInputs) {
        const v = getModulatedValue(selectedLayerIndex, input.NAME);
        if (v !== null) newVals[input.NAME] = v;
      }
      modGhostValues = newVals;
      modGhostRaf = requestAnimationFrame(tick);
    };
    modGhostRaf = requestAnimationFrame(tick);
  }

  function stopModGhostLoop() {
    if (modGhostRaf !== null) {
      cancelAnimationFrame(modGhostRaf);
      modGhostRaf = null;
    }
    modGhostValues = {};
  }

  // Start/stop ghost loop when shader params panel is visible
  $: if (showShaderParams && selectedLayerIndex !== null) {
    startModGhostLoop();
  } else {
    stopModGhostLoop();
  }

  // Drag handlers
  function handleDragStart(e: DragEvent, clip: VJDragPayload) {
    cellDragInProgress = true;
    cellPress = null;
    draggedClip = clip;
    // Electron/Chromium requires dataTransfer.setData() for drag to work
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      const payload = JSON.stringify(clip);
      e.dataTransfer.setData('application/x-ghost-vj-clip', payload);
      e.dataTransfer.setData('text/plain', payload);
    }
  }

  function handleDragEnd() {
    draggedClip = null;
    dragOverCell = null;
    dragSourceCell = null;
    cellPress = null;
    // Native dragend can arrive just before pointerup on macOS. Keep the
    // guard through this task so releasing a trackpad drag cannot fire a clip.
    setTimeout(() => { cellDragInProgress = false; }, 0);
  }

  // ─── VJ Media Library File Import (drag/drop + file picker) ────────
  let vjMediaFileInput: HTMLInputElement | null = null;
  let vjMediaDragOver = false;

  function vjMediaGetType(file: File): 'video' | 'image' | 'shader' | null {
    const n = file.name.toLowerCase();
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(n)) return 'video';
    if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(n)) return 'image';
    if (/\.(fs|isf)$/i.test(n)) return 'shader';
    return null;
  }

  async function vjCaptureVideoThumb(video: HTMLVideoElement): Promise<string> {
    return new Promise((resolve) => {
      const grab = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 120; canvas.height = 68;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.7)); }
        else resolve('');
      };
      if (video.readyState >= 2) { video.currentTime = 0.1; video.onseeked = grab; setTimeout(() => { if (video.onseeked) grab(); }, 300); }
      else { video.onloadeddata = () => { video.currentTime = 0.1; video.onseeked = grab; }; }
    });
  }

  async function vjAddMediaFile(file: File): Promise<MediaItem | null> {
    const kind = vjMediaGetType(file);
    if (!kind) { console.warn('[VJ Media] Unsupported file type:', file.name); return null; }
    // Capture both runtime URL and durable AssetRef so VJ media library entries
    // survive save/reload (the blob URL alone won't).
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    if (kind === 'video') {
      const video = document.createElement('video');
      // crossOrigin BEFORE src — order matters on Chromium 130.
      video.crossOrigin = 'anonymous'; video.loop = true; video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.src = url;
      // `.src=` already initiated the load — don't call `.load()`.
      await new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('loadeddata', done); video.removeEventListener('error', done); resolve(); };
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('error', done, { once: true });
        if (video.readyState >= 2) done();
      });
      const item: MediaItem = {
        id: generateUUID(),
        name: file.name,
        src: url,
        type: 'video',
        videoElement: video,
        thumbnail: await vjCaptureVideoThumb(video),
        _assetRef: assetRef,
      };
      mediaLibrary.addItem(item);
      return item;
    } else if (kind === 'image') {
      const item: MediaItem = {
        id: generateUUID(),
        name: file.name,
        src: url,
        type: 'image',
        thumbnail: url,
        _assetRef: assetRef,
      };
      mediaLibrary.addItem(item);
      return item;
    }
    return null;
  }

  async function vjHandleMediaDrop(e: DragEvent) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    vjMediaDragOver = false;
    for (const f of Array.from(files)) { await vjAddMediaFile(f); }
  }

  function vjHandleMediaDragOver(e: DragEvent) {
    // Only show overlay for actual file drops, not clip drags from the grid
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      vjMediaDragOver = true;
    }
  }

  function vjHandleMediaDragLeave(e: DragEvent) {
    // Only clear when leaving the outer container
    if ((e.currentTarget as HTMLElement) === e.target) vjMediaDragOver = false;
  }

  async function vjHandleMediaFilePick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    for (const f of Array.from(files)) { await vjAddMediaFile(f); }
    input.value = '';
  }

  function handleClipCellDragStart(e: DragEvent, layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    const clip = deckGrid(bank)[layerIndex]?.[columnIndex];
    if (!clip || !e.dataTransfer) return;
    cellDragInProgress = true;
    cellPress = null;
    dragSourceCell = { layer: layerIndex, column: columnIndex, bank };
    draggedClip = { type: clip.type as any, id: clip.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'cell-move');
  }

  function handleCellDragOver(e: DragEvent, layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.dataTransfer.files.length > 0 ? 'copy' : (dragSourceCell ? 'move' : 'copy');
    }
    dragOverCell = { layer: layerIndex, column: columnIndex, bank };
  }

  function handleCellDragLeave() {
    dragOverCell = null;
  }

  // File loading helper for splat/model3d VJ clips
  function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function triggerVJFileLoad(layerIndex: number, columnIndex: number, type: 'splat' | 'model3d', bank: VJDeck = 'A') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'splat' ? '.ply,.splat' : '.glb,.gltf,.obj,.fbx';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Capture the outgoing clip's blob URL (if any) so we can revoke after
      // the swap. Without this, overwriting a 500MB .ply on a cell accumulates
      // the old blob forever — a 4-hour set cycling through clips accumulates
      // gigabytes in renderer heap.
      const existing = deckGrid(bank)[layerIndex]?.[columnIndex] as any;
      const priorBlobUrl: string | null =
        existing?.splatContent?.filePath && existing.splatContent.filePath.startsWith('blob:')
          ? existing.splatContent.filePath
          : (existing?.model3dContent || existing?.model3DContent)?.modelData?.startsWith?.('blob:')
          ? (existing.model3dContent || existing.model3DContent).modelData
          : null;

      if (type === 'splat') {
        // Use blob URL for splat files (more efficient than data URLs for binary).
        // Pair with AssetRef so the clip survives save/reload — without it,
        // every VJ splat clip comes back broken after closing the app.
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        const isSplatFormat = file.name.toLowerCase().endsWith('.splat');
        vjClipLauncher.updateClipSplatContent(layerIndex, columnIndex, {
          filePath: blobUrl,
          dataType: isSplatFormat ? 'gaussian' : 'pointcloud',
          _originalFileName: file.name,  // Pass filename so Canvas can detect .splat format
          _assetRef: assetRef,
        } as any, bank);
        vjClipLauncher.setClip(layerIndex, columnIndex, {
          ...(deckGrid(bank)[layerIndex]?.[columnIndex] as VJClip),
          name: file.name.replace(/\.[^.]+$/, ''),
        }, bank);
      } else {
        // Use blob URL for 3D model files. AssetRef carries the durable disk
        // path so save/reload restores the model — blob URLs alone can't.
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';
        vjClipLauncher.updateClipModel3DContent(layerIndex, columnIndex, {
          modelData: blobUrl,
          modelFormat: ext as Model3DFormat,
          modelName: file.name,
          _assetRef: assetRef,
        } as any, bank);
        vjClipLauncher.setClip(layerIndex, columnIndex, {
          ...(deckGrid(bank)[layerIndex]?.[columnIndex] as VJClip),
          name: file.name.replace(/\.[^.]+$/, ''),
        }, bank);
      }

      // Revoke after a short tick — gives Canvas a frame to swap in the new
      // texture before we yank the old one from memory.
      if (priorBlobUrl) {
        setTimeout(() => { try { URL.revokeObjectURL(priorBlobUrl); } catch {} }, 500);
      }
    };
    input.click();
  }

  // Re-trigger file load for existing splat/model3d clip (right-click or double-click)
  function reloadVJClipFile(layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    const clip = deckGrid(bank)[layerIndex]?.[columnIndex];
    if (!clip) return;
    if (clip.type === 'splat' || clip.type === 'model3d') {
      triggerVJFileLoad(layerIndex, columnIndex, clip.type, bank);
    }
  }

  function createVJClipFromMediaTrayPayload(payload: MediaTrayDropPayload): VJClip | null {
    if (payload.type === 'preset') {
      // Mapping preset dragged in from the bottom Presets tray (VJ MAP
      // sub-mode) — same clip shape the in-panel Maps tab drag creates.
      const comp = $compositions.find((c) => c.id === payload.id);
      if (!comp) return null;
      return {
        id: generateUUID(),
        type: 'preset',
        name: comp.name,
        src: comp.id,
        thumbnail: comp.thumbnail,
        presetId: comp.id,
      };
    }

    if (payload.type === 'gpu') {
      const gpuLayerContent = createDefaultGPULayerContent();
      const shaderDef = getShaderDef(gpuLayerContent.shaderId);
      gpuLayerContent.params = { ...(shaderDef?.defaultParams || {}) };
      return {
        id: generateUUID(),
        type: 'gpu',
        name: payload.name,
        src: payload.src,
        gpuLayerContent,
      };
    }

    if (payload.type === 'text') {
      return {
        id: generateUUID(),
        type: 'text',
        name: payload.name,
        src: payload.src,
        textContent: createDefaultTextContent(),
      };
    }

    if (payload.type === 'synthvision') {
      // Performer clip — firing the cell opens the keyboard overlay bound to
      // that layer. Effects live on the clip, not the layer row.
      return {
        id: generateUUID(),
        type: 'synthvision',
        name: payload.name || 'Performer',
        src: payload.src || 'performer',
        effects: [],
      };
    }

    if (payload.type === 'live-source') {
      const registeredSource = findMediaTrayLiveSource(payload.id);
      const source = (payload.videoEl || payload.stream) ? payload : (registeredSource ?? payload);
      return createVJClipFromMediaTrayLiveSource(source);
    }

    if (payload.type === 'effect') {
      const effectType = payload.effectSource?.effectType || payload.effectType || 'fluid';
      const manifest = getPluginByEffectType(effectType);
      return {
        id: generateUUID(),
        type: 'effect',
        name: payload.pluginName || payload.name || manifest?.name || payload.id,
        src: payload.src || effectType,
        effectSource: {
          effectType,
          ...(manifest?.defaultSourceParams ?? {}),
          ...(payload.effectSource ?? {}),
        },
      };
    }

    if (payload.type === 'shader') {
      if (!payload.shaderCode) return null;
      return {
        id: generateUUID(),
        type: 'shader',
        name: payload.name,
        src: payload.src,
        thumbnail: payload.thumbnail,
        shaderCode: payload.shaderCode,
        shaderValues: { ...(payload.shaderValues ?? {}) },
      };
    }

    if (payload.type === 'video' || payload.type === 'image') {
      return {
        id: generateUUID(),
        type: payload.type,
        name: payload.name,
        src: payload.src,
        thumbnail: payload.thumbnail,
        _assetRef: payload._assetRef,
      };
    }

    if ('jsAnimation' in payload && payload.jsAnimation) {
      return {
        id: generateUUID(),
        type: payload.type === 'p5js' ? 'p5js' : 'jsanimation',
        name: payload.name,
        src: payload.src || 'js-animation',
        thumbnail: payload.thumbnail,
        jsAnimation: { ...payload.jsAnimation },
      };
    }

    if (payload.type === 'threejs') {
      return {
        id: generateUUID(),
        type: 'threejs',
        name: payload.name,
        src: payload.src,
        thumbnail: payload.thumbnail,
      };
    }

    return null;
  }

  function createVJClipFromMediaItem(item: MediaItem): VJClip {
    return {
      id: generateUUID(),
      type: item.type,
      name: item.name,
      src: item.src,
      thumbnail: item.thumbnail,
      _assetRef: item._assetRef,
    };
  }

  // Finder / Explorer files can go straight to the performance deck. The
  // target cell receives the first supported file; additional files fill
  // empty cells in deck order. Every file also enters the Media Library.
  // (Async because the native import path awaits video loadeddata before
  // the clip element is deck-ready.)
  async function importDroppedFilesToDeck(files: File[], layerIndex: number, columnIndex: number, bank: VJDeck) {
    const grid = deckGrid(bank);
    const targets = [
      { layer: layerIndex, column: columnIndex },
      ...layerIndices.flatMap((layer) => columnIndices.map((column) => ({ layer, column })))
        .filter(({ layer, column }) =>
          !(layer === layerIndex && column === columnIndex) && !grid[layer]?.[column]
        ),
    ];
    let placed = 0;
    for (const file of files) {
      const item = await vjAddMediaFile(file);
      if (!item) continue;
      const target = targets[placed];
      if (!target) {
        showToast('Media imported, but there are no more empty VJ deck slots.', 'warning');
        break;
      }
      vjClipLauncher.setClip(target.layer, target.column, createVJClipFromMediaItem(item), bank);
      placed += 1;
    }
    if (placed > 0) {
      selectedLayerIndex = layerIndex;
      showShaderParams = true;
      if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);
    }
  }

  /** Materialize a saved (IndexedDB) video into a deck cell. Loads the blob,
   *  captures a durable AssetRef so the clip survives save/reload, and binds
   *  a ready <video> element to the cell. */
  async function bindSavedVideoToCell(
    saved: { id: string; name: string; thumbnail?: string; blobKey: string },
    layerIndex: number,
    columnIndex: number,
    bank: VJDeck,
  ) {
    try {
      const blob = await videoLibrary.loadVideoBlob(saved.blobKey);
      if (!blob) {
        console.warn('[VJ] saved video blob missing:', saved.name);
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      const { assetRef } = await createAssetRefFromGeneratedBlob(
        blob,
        `${(saved.name || 'Saved Video').replace(/\.[^.]+$/, '')}.mp4`,
        blob.type || 'video/mp4',
        blobUrl,
      );
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = blobUrl;
      vjClipLauncher.setClip(layerIndex, columnIndex, {
        id: generateUUID(),
        type: 'video',
        name: saved.name || 'Saved Video',
        src: blobUrl,
        thumbnail: saved.thumbnail,
        videoElement: video,
        _assetRef: assetRef,
      } as VJClip, bank);
    } catch (err) {
      console.warn('[VJ] failed to load saved video into cell:', err);
    }
  }

  function handleCellDrop(e: DragEvent, layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    e.preventDefault();
    e.stopPropagation();
    dragOverCell = null;

    // Direct OS-file → deck cell drop (release v1.9.99x behavior).
    const externalFiles = Array.from(e.dataTransfer?.files ?? []);
    if (externalFiles.length > 0) {
      void importDroppedFilesToDeck(externalFiles, layerIndex, columnIndex, bank);
      draggedClip = null;
      dragSourceCell = null;
      cellPress = null;
      cellDragInProgress = false;
      return;
    }

    // Cell-to-cell move OR swap. Resolume-style behavior: if the
    // destination cell is empty, move the source clip into it (clearing
    // the source). If the destination cell ALREADY has a clip, SWAP the
    // two — neither clip is destroyed, they just trade places. This is
    // what users expect when dragging clips between layers in the grid;
    // the previous "always replace / clear source" behavior was nuking
    // work mid-set when users dropped onto a populated cell. Swap also
    // works across decks (Bank A ↔ Bank B).
    if (dragSourceCell) {
      const srcClip = deckGrid(dragSourceCell.bank)[dragSourceCell.layer]?.[dragSourceCell.column];
      const destClip = deckGrid(bank)[layerIndex]?.[columnIndex];
      const sameSpot =
        dragSourceCell.bank === bank &&
        dragSourceCell.layer === layerIndex &&
        dragSourceCell.column === columnIndex;
      if (srcClip && !sameSpot) {
        const movedClip: VJClip = { ...srcClip, id: generateUUID() };
        vjClipLauncher.setClip(layerIndex, columnIndex, movedClip, bank);
        if (destClip) {
          // Dest had a clip → swap it back to the source slot.
          const swappedClip: VJClip = { ...destClip, id: generateUUID() };
          vjClipLauncher.setClip(dragSourceCell.layer, dragSourceCell.column, swappedClip, dragSourceCell.bank);
        } else {
          // Dest was empty → clear the source (true move semantics).
          vjClipLauncher.clearClip(dragSourceCell.layer, dragSourceCell.column, dragSourceCell.bank);
        }
      }
      dragSourceCell = null;
      draggedClip = null;
      return;
    }

    if (!draggedClip && e.dataTransfer) {
      const payload = mediaTrayPayloadFromDataTransfer(e.dataTransfer);
      if (payload) {
        const vjClip = createVJClipFromMediaTrayPayload(payload);
        if (vjClip) {
          vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
          selectedLayerIndex = layerIndex;
          showShaderParams = true;
          if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);
          return;
        }
      }
    }

    if (!draggedClip && e.dataTransfer) {
      const raw = e.dataTransfer.getData('application/x-ghost-vj-clip') || e.dataTransfer.getData('text/plain');
      try {
        const parsed = raw ? JSON.parse(raw) as VJDragPayload : null;
        if (parsed && typeof parsed.type === 'string' && typeof parsed.id === 'string') {
          draggedClip = parsed;
        }
      } catch {
        const media = raw ? $mediaLibrary.find(m => m.id === raw) : null;
        if (media) {
          draggedClip = { type: media.type, id: media.id };
        } else if (raw && shaders.some(s => s.id === raw)) {
          draggedClip = { type: 'shader', id: raw };
        } else if (raw && threejsItems.some(t => t.id === raw)) {
          draggedClip = { type: 'threejs', id: raw };
        }
      }
    }

    if (!draggedClip) return;

    if (draggedClip.type === 'live-source') {
      const liveSource = vjLiveSources.find((source) => source.id === draggedClip!.id);
      const traySource = findMediaTrayLiveSource(draggedClip.id);
      const vjClip = liveSource
        ? createVJClipFromLiveSource(liveSource)
        : (traySource ? createVJClipFromMediaTrayLiveSource(traySource) : null);
      if (vjClip) {
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      }
    } else if (draggedClip.type === 'shader') {
      // Library-tab items live in the saved-shader store, not the built-in
      // catalog — without this fallback, dragging one onto a cell silently
      // did nothing because the id was never found.
      const catalogShader = shaders.find(s => s.id === draggedClip!.id);
      const savedShader = catalogShader ? null : savedShaders.find(s => s.id === draggedClip!.id);
      const shader = catalogShader ?? (savedShader
        ? {
            id: savedShader.id,
            name: savedShader.name,
            src: '',
            thumbnail: savedShader.thumbnail,
            shaderCode: savedShader.code,
            values: {} as Record<string, any>,
          }
        : null);
      if (shader) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: 'shader',
          name: shader.name,
          src: shader.src,
          thumbnail: shader.thumbnail,
          shaderCode: shader.shaderCode,
          shaderValues: { ...shader.values },
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      }
    } else if (draggedClip.type === 'threejs') {
      const threejsItem = threejsItems.find(t => t.id === draggedClip!.id);
      if (threejsItem) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: 'threejs',
          name: threejsItem.name,
          src: threejsItem.src,
          thumbnail: threejsItem.thumbnail,
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      }
    } else if (draggedClip.type === 'spout') {
      // Spout drag — covers two cases distinguished by whether the
      // dragged source.id matches an NDI live source. NDI clips
      // travel through the 'spout' clip type to reuse all the
      // receiver / texture / render plumbing; Canvas tells them apart
      // by source.ndiSource vs spoutSource. Naming is regrettable
      // ("spout" became the umbrella for live-stream-from-elsewhere
      // because Spout was the first one) — kept for back-compat with
      // saved projects.
      const ndiLive = vjLiveSources.find(s => s.id === draggedClip!.id && s.type === 'ndi');
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'spout',
        name: draggedClip.pluginName || draggedClip.id,
        src: draggedClip.spoutName || draggedClip.id,
      };
      if (ndiLive) {
        // Stash the NDI source name in the clip's media-source bundle
        // so the Canvas receiver-loader picks the NDI branch instead
        // of Spout's. ndiSourceName carried through from the live-source.
        vjClip.ndiSource = {
          senderName: ndiLive.ndiSourceName || draggedClip.spoutName || draggedClip.id,
          width: 1920,
          height: 1080,
        };
      } else {
        vjClip.spoutSource = draggedClip.spoutName;
      }
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
    } else if (draggedClip.type === 'effect') {
      // Handle integrated effect (FluidGen, Particles3D, Milkdrop running natively).
      // Seed the effectSource with the plugin's defaultSourceParams so the
      // clip behaves the same as a freshly-applied plugin layer — without
      // this, a dropped Milkdrop clip would have no preset pack, no
      // sensitivity, etc., and fall back to per-field "??" defaults in the
      // Canvas hook (still works, but the panel shows empty values).
      const effectType = draggedClip.effectType || 'fluid';
      const manifest = getPluginByEffectType(effectType);
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'effect',
        name: draggedClip.pluginName || draggedClip.id,
        src: effectType,
        effectSource: {
          effectType,
          ...(manifest?.defaultSourceParams ?? {}),
        },
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
    } else if (draggedClip.type === 'gpu') {
      const gpuLayerContent = createDefaultGPULayerContent();
      const shaderDef = getShaderDef(gpuLayerContent.shaderId);
      gpuLayerContent.params = { ...(shaderDef?.defaultParams || {}) };
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'gpu',
        name: 'GPU Shader',
        src: 'gpu-layer',
        gpuLayerContent,
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
    } else if (draggedClip.type === 'text') {
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'text',
        name: 'Text Creator',
        src: 'text-layer',
        textContent: createDefaultTextContent(),
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
    } else if (draggedClip.type === 'synthvision') {
      // Performer is a deck clip like any other plugin: dropping it claims a
      // cell, and firing that cell opens the keyboard overlay bound to this
      // layer. Its effects live on the clip (see clip-scoped effect calls in
      // SynthVision) rather than on the shared layer row.
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'synthvision',
        name: 'Performer',
        src: 'performer',
        effects: [],
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
    } else if (draggedClip.type === 'splat') {
      // Handle point cloud / splat clip
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'splat',
        name: draggedClip.pluginName || 'Point Cloud',
        src: '',
        splatContent: createDefaultSplatContent(),
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      // Trigger file picker for PLY file
      triggerVJFileLoad(layerIndex, columnIndex, 'splat', bank);
    } else if (draggedClip.type === 'model3d') {
      // Handle 3D model clip
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'model3d',
        name: draggedClip.pluginName || '3D Model',
        src: '',
        model3dContent: createDefaultModel3DContent(),
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      // Trigger file picker for 3D model file
      triggerVJFileLoad(layerIndex, columnIndex, 'model3d', bank);
    } else if (draggedClip.type === 'preset') {
      // Handle mapping-preset clip: stores the composition id; firing
      // calls project.loadComposition() to swap the mapping topology.
      const comp = $compositions.find((c) => c.id === draggedClip!.id);
      if (comp) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: 'preset',
          name: comp.name,
          src: comp.id,
          thumbnail: comp.thumbnail,
          presetId: comp.id,
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      }
    } else {
      const media = $mediaLibrary.find(m => m.id === draggedClip!.id);
      if (media) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: draggedClip.type,
          name: media.name,
          src: media.src,
          thumbnail: media.thumbnail,
          _assetRef: (media as any)._assetRef,
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip, bank);
      } else {
        // Saved videos live in IndexedDB, not the session media library —
        // materialize the blob (and a durable AssetRef) before binding the
        // cell, the same way the media tray's Load button does.
        const savedVideo = savedVideos.find(v => v.id === draggedClip!.id);
        if (savedVideo) {
          void bindSavedVideoToCell(savedVideo, layerIndex, columnIndex, bank);
        }
      }
    }

    // Don't auto-trigger - user clicks to play
    draggedClip = null;
  }

  // Click on clip cell to trigger it and auto-select layer for shader params
  function handleCellClick(layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    vjClipLauncher.triggerClip(layerIndex, columnIndex, bank);
    // Auto-select this layer so shader params show, and remember which deck
    // we're operating on (panels follow this when the crossfader is on).
    selectedLayerIndex = layerIndex;
    showShaderParams = true;
    if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank);

    // Firing a Performer clip opens the keyboard overlay bound to the layer
    // the clip sits on — that binding is what keeps its worlds, clips and
    // effects on this row instead of a separately-chosen one.
    const firedClip = deckGrid(bank)[layerIndex]?.[columnIndex];
    if (firedClip?.type === 'synthvision') {
      synthVisionStore.setAssignedLayer(layerIndex);
      performerStarted = true;
      showPerformer = true;
    }
  }

  function isCellControlTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a'));
  }

  function handleCellPointerDown(e: PointerEvent, layerIndex: number, columnIndex: number, bank: VJDeck) {
    if (!e.isPrimary || e.button !== 0 || isCellControlTarget(e.target)) return;
    cellPress = {
      pointerId: e.pointerId,
      layer: layerIndex,
      column: columnIndex,
      bank,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  }

  function handleCellPointerMove(e: PointerEvent) {
    if (!cellPress || cellPress.pointerId !== e.pointerId || cellPress.moved) return;
    cellPress.moved = Math.hypot(e.clientX - cellPress.startX, e.clientY - cellPress.startY) > CELL_PRESS_SLOP_PX;
  }

  function handleCellPointerUp(e: PointerEvent, layerIndex: number, columnIndex: number, bank: VJDeck) {
    const press = cellPress;
    cellPress = null;
    if (
      !press ||
      press.pointerId !== e.pointerId ||
      press.layer !== layerIndex ||
      press.column !== columnIndex ||
      press.bank !== bank ||
      press.moved ||
      cellDragInProgress ||
      isCellControlTarget(e.target)
    ) return;
    lastPointerTriggerAt = performance.now();
    handleCellClick(layerIndex, columnIndex, bank);
  }

  function handleCellPointerCancel() {
    cellPress = null;
  }

  function handleCellClickEvent(e: MouseEvent, layerIndex: number, columnIndex: number, bank: VJDeck) {
    // Pointerup already handled physical clicks. Keep zero-detail synthetic
    // clicks available for accessibility and external control integrations.
    if (e.detail > 0 && performance.now() - lastPointerTriggerAt < 350) return;
    handleCellClick(layerIndex, columnIndex, bank);
  }

  function handleCellKeyDown(e: KeyboardEvent, layerIndex: number, columnIndex: number, bank: VJDeck) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleCellClick(layerIndex, columnIndex, bank);
  }

  // Clear a clip from cell
  function handleClearClip(layerIndex: number, columnIndex: number, e: Event, bank: VJDeck = 'A') {
    e.stopPropagation();
    vjClipLauncher.clearClip(layerIndex, columnIndex, bank);
  }

  // Trigger entire column
  function handleColumnTrigger(columnIndex: number, bank: VJDeck = 'A') {
    vjClipLauncher.triggerColumn(columnIndex, bank);
  }

  // Stop layer
  function handleStopLayer(layerIndex: number, bank: VJDeck = 'A') {
    vjClipLauncher.stopLayer(layerIndex, bank);
  }

  // Stop all (always sweeps both decks — store-side stopAll handles both banks)
  function handleStopAll() {
    vjClipLauncher.stopAll();
  }

  // Context menu for clip cells
  function handleCellContextMenu(e: MouseEvent, layerIndex: number, columnIndex: number, bank: VJDeck = 'A') {
    e.preventDefault();
    cellContextMenu = { x: e.clientX, y: e.clientY, layer: layerIndex, column: columnIndex, bank };
  }

  function closeCellContextMenu() {
    cellContextMenu = null;
  }

  function copyClipToClipboard() {
    if (!cellContextMenu) return;
    const clip = deckGrid(cellContextMenu.bank)[cellContextMenu.layer]?.[cellContextMenu.column];
    if (clip) clipboardClip = { ...clip };
    cellContextMenu = null;
  }

  function pasteClipFromClipboard() {
    if (!cellContextMenu || !clipboardClip) return;
    const pasted: VJClip = { ...clipboardClip, id: generateUUID() };
    vjClipLauncher.setClip(cellContextMenu.layer, cellContextMenu.column, pasted, cellContextMenu.bank);
    cellContextMenu = null;
  }

  function openClipPreview() {
    if (!cellContextMenu) return;
    const clip = deckGrid(cellContextMenu.bank)[cellContextMenu.layer]?.[cellContextMenu.column];
    if (!clip) return;
    previewPanel = { layer: cellContextMenu.layer, column: cellContextMenu.column, clip, bank: cellContextMenu.bank };
    cellContextMenu = null;
  }

  function clearClipFromMenu() {
    if (!cellContextMenu) return;
    vjClipLauncher.clearClip(cellContextMenu.layer, cellContextMenu.column, cellContextMenu.bank);
    cellContextMenu = null;
  }

  // Layer controls
  function handleLayerOpacityChange(layerIndex: number, e: Event, bank: VJDeck = 'A') {
    markUserInteracting(`vj${bank === 'B' ? '-b' : ''}:${layerIndex}:opacity`);
    const value = parseFloat((e.target as HTMLInputElement).value);
    vjClipLauncher.setLayerOpacity(layerIndex, value, bank);
  }

  function handleLayerBlendChange(layerIndex: number, e: Event, bank: VJDeck = 'A') {
    const value = (e.target as HTMLSelectElement).value as BlendMode;
    vjClipLauncher.setLayerBlendMode(layerIndex, value, bank);
  }

  function handleToggleSolo(layerIndex: number, bank: VJDeck = 'A') {
    vjClipLauncher.toggleLayerSolo(layerIndex, bank);
  }

  function handleToggleMute(layerIndex: number, bank: VJDeck = 'A') {
    vjClipLauncher.toggleLayerMute(layerIndex, bank);
  }

  // Master opacity
  function handleMasterOpacityChange(e: Event) {
    markUserInteracting('vj:master:opacity');
    const value = parseFloat((e.target as HTMLInputElement).value);
    vjClipLauncher.setMasterOpacity(value);
  }

  // Select layer for shader params editing
  function selectLayerForEffects(layerIndex: number) {
    selectedLayerIndex = selectedLayerIndex === layerIndex ? null : layerIndex;
    // Re-show shader params when selecting a new layer
    if (selectedLayerIndex !== null) {
      showShaderParams = true;
    }
  }

  // Block management handlers
  function handleAddBlock() {
    vjClipLauncher.addBlock();
  }

  function handleSelectBlock(blockId: string) {
    vjClipLauncher.setActiveBlock(blockId);
  }

  function startEditingBlock(block: VJBlock, e: MouseEvent) {
    e.stopPropagation();
    editingBlockId = block.id;
    editingBlockName = block.name;
    // Focus the input after render
    setTimeout(() => blockInputEl?.focus(), 0);
  }

  function finishEditingBlock() {
    if (editingBlockId && editingBlockName.trim()) {
      vjClipLauncher.renameBlock(editingBlockId, editingBlockName.trim());
    }
    editingBlockId = null;
    editingBlockName = '';
  }

  function handleBlockKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditingBlock();
    } else if (e.key === 'Escape') {
      editingBlockId = null;
      editingBlockName = '';
    }
  }

  function handleDeleteBlock(blockId: string, e: MouseEvent) {
    e.stopPropagation();
    vjClipLauncher.deleteBlock(blockId);
  }

  function handleBlockDragStart(e: DragEvent, blockIdx: number) {
    if (editingBlockId) {
      e.preventDefault();
      return;
    }
    draggedBlockIndex = blockIdx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-ghost-vj-block', String(blockIdx));
    }
  }

  function handleBlockDragOver(e: DragEvent, blockIdx: number) {
    if (draggedBlockIndex === null) return;
    e.preventDefault();
    dragOverBlockIndex = blockIdx;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handleBlockDrop(e: DragEvent, blockIdx: number) {
    e.preventDefault();
    const rawIndex = e.dataTransfer?.getData('application/x-ghost-vj-block');
    const fromIndex = draggedBlockIndex ?? (rawIndex ? Number(rawIndex) : NaN);
    if (Number.isFinite(fromIndex)) {
      vjClipLauncher.reorderBlocks(fromIndex, blockIdx);
    }
    draggedBlockIndex = null;
    dragOverBlockIndex = null;
  }

  function handleBlockDragEnd() {
    draggedBlockIndex = null;
    dragOverBlockIndex = null;
  }

  // Layer drag handlers for reordering
  function handleLayerDragStart(layerIndex: number, e: DragEvent) {
    draggedLayerIndex = layerIndex;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layerIndex.toString());
    }
  }

  function handleLayerDragEnd() {
    draggedLayerIndex = null;
    dragOverLayerIndex = null;
  }

  function handleLayerDragOver(layerIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedLayerIndex !== null && draggedLayerIndex !== layerIndex) {
      dragOverLayerIndex = layerIndex;
    }
  }

  function handleLayerDragLeave() {
    dragOverLayerIndex = null;
  }

  function handleLayerDrop(layerIndex: number, e: DragEvent, bank: VJDeck = 'A') {
    e.preventDefault();
    const payload = mediaTrayPayloadFromDataTransfer(e.dataTransfer);
    if (payload) {
      placeMediaTrayPayloadOnLayer(payload, layerIndex, bank);
      draggedLayerIndex = null;
      dragOverLayerIndex = null;
      return;
    }

    if (draggedLayerIndex !== null && draggedLayerIndex !== layerIndex) {
      vjClipLauncher.reorderLayers(draggedLayerIndex, layerIndex);
    }
    draggedLayerIndex = null;
    dragOverLayerIndex = null;
  }

  // Handle multi-add from the effect picker modal
  function handlePickerAdd(types: EffectType[]) {
    for (const type of types) {
      addEffect(type);
    }
    showEffectPicker = false;
  }

  // Effect management
  function addEffect(type: EffectType) {
    const newEffect: Effect = {
      id: generateUUID(),
      type,
      enabled: true,
      params: getRendererDefaultEffectParams(type),
    };
    if (effectsTab === 'composition') {
      vjClipLauncher.addCompositionEffect(newEffect);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = paramLayerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.addClipEffect(selectedLayerIndex, activeCol, newEffect, paramDeck);
    } else {
      // layer
      if (selectedLayerIndex === null) return;
      vjClipLauncher.addLayerEffect(selectedLayerIndex, newEffect, paramDeck);
    }
  }

  function toggleEffect(effectId: string) {
    if (effectsTab === 'composition') {
      vjClipLauncher.toggleCompositionEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = paramLayerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.toggleClipEffect(selectedLayerIndex, activeCol, effectId, paramDeck);
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.toggleLayerEffect(selectedLayerIndex, effectId, paramDeck);
    }
  }

  function deleteEffect(effectId: string) {
    if (effectsTab === 'composition') {
      vjClipLauncher.removeCompositionEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = paramLayerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.removeClipEffect(selectedLayerIndex, activeCol, effectId, paramDeck);
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.removeLayerEffect(selectedLayerIndex, effectId, paramDeck);
    }
    expandedEffectId = null;
  }

  function updateEffectParam(effectId: string, paramName: string, value: number | boolean) {
    if (effectsTab === 'composition') {
      vjClipLauncher.updateCompositionEffectParams(effectId, { [paramName]: value });
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = paramLayerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.updateClipEffectParams(selectedLayerIndex, activeCol, effectId, { [paramName]: value }, paramDeck);
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.updateLayerEffectParams(selectedLayerIndex, effectId, { [paramName]: value }, paramDeck);
    }
  }

  function applyVJPreset(effect: Effect) {
    const raw = vjPresetSelection[effect.id];
    if (raw === undefined || raw === '') return;
    const idx = parseInt(raw, 10);
    if (Number.isNaN(idx)) return;
    const patch = applyPresetToEffect(effect, idx);
    if (!patch) return;
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number' || typeof v === 'boolean') {
        updateEffectParam(effect.id, k, v);
      }
    }
  }

  function applyVJMacroValue(effectId: string, which: 'm1' | 'm2', value: number) {
    const binding = vjMacroBindings[effectId]?.[which];
    if (!binding) return;
    updateEffectParam(effectId, binding, value);
  }

  function onVJMacro1Change(v: number) {
    vjMacro1 = v;
    for (const eff of currentEffects) applyVJMacroValue(eff.id, 'm1', v);
  }

  function onVJMacro2Change(v: number) {
    vjMacro2 = v;
    for (const eff of currentEffects) applyVJMacroValue(eff.id, 'm2', v);
  }

  // Get filtered media based on active tab.
  //
  // Memoized per-tab: the previous implementation walked the full `$mediaLibrary`
  // twice (video+image filter), mapped shaders, and mapped threejsItems on every
  // reactive tick — including every audio-frame tick — even when the user was
  // on a single tab that only needed one of the four source arrays. With audio
  // running that was ~60 × (2N+M+K) allocations/second. Now we only do the work
  // for the currently-selected tab, and only when its source changed.
  let _vjMediaVideos: any[] = [];
  let _vjMediaImages: any[] = [];
  let _vjMediaShaders: any[] = [];
  let _vjMediaThreejs: any[] = [];
  let _vjMediaLib: any = null;
  let _vjMediaShadersSrc: any = null;
  let _vjMediaThreejsSrc: any = null;

  $: {
    // $mediaLibrary changed → refresh the video/image-derived slices
    if ($mediaLibrary !== _vjMediaLib) {
      _vjMediaLib = $mediaLibrary;
      _vjMediaVideos = $mediaLibrary
        .filter(m => m.type === 'video')
        .map(m => ({ ...m, itemType: 'video' as const }));
      _vjMediaImages = $mediaLibrary
        .filter(m => m.type === 'image')
        .map(m => ({ ...m, itemType: 'image' as const }));
    }
    if (shaders !== _vjMediaShadersSrc) {
      _vjMediaShadersSrc = shaders;
      _vjMediaShaders = shaders.map(s => ({
        id: s.id, name: s.name, thumbnail: s.thumbnail, src: s.src,
        itemType: 'shader' as const,
      }));
    }
    if (threejsItems !== _vjMediaThreejsSrc) {
      _vjMediaThreejsSrc = threejsItems;
      _vjMediaThreejs = threejsItems.map(t => ({
        id: t.id, name: t.name, thumbnail: t.thumbnail, src: t.src,
        itemType: 'threejs' as const,
      }));
    }
  }

  $: vjFilteredMedia =
      vjMediaTab === 'videos' ? _vjMediaVideos
    : vjMediaTab === 'images' ? _vjMediaImages
    : vjMediaTab === 'shaders' ? _vjMediaShaders
    : vjMediaTab === 'js' ? _vjMediaThreejs
    : [..._vjMediaShaders, ..._vjMediaThreejs, ..._vjMediaVideos, ..._vjMediaImages];

  // Handle AI generated shader in VJ mode
  function handleVJAIGenerated() {
    vjShowAIGenerator = false;
  }

  // Handle AI generated video in VJ mode — add the clip to the media
  // library (shared with mapping mode) so it shows up in the Vid tab
  // immediately with a thumbnail, and persist to IndexedDB for the
  // Saved tab. Mirrors MediaTray.handleAIVideoGenerated.
  async function handleVJAIVideoGenerated(event: CustomEvent<{ id: string; name: string; src: string; blob: Blob }>) {
    const { id, name, src, blob } = event.detail || ({} as any);

    vjShowVideoGenerator = false;
    vjMediaTab = 'videos';

    if (!blob) {
      console.warn('[VJ AI Video] no blob in event.detail');
      return;
    }

    const videoBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(videoBlob);
    const { assetRef } = await createAssetRefFromGeneratedBlob(
      videoBlob,
      `${(name || 'AI Video').replace(/\.[^.]+$/, '')}.mp4`,
      videoBlob.type || 'video/mp4',
      blobUrl,
    );

    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = blobUrl;

    mediaLibrary.addItem({
      id,
      name,
      src: blobUrl,
      type: 'video',
      videoElement: video,
      thumbnail: '',
      _assetRef: assetRef,
    } as any);

    // `.src=` already initiated the load — don't call `.load()`.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      video.oncanplaythrough = done;
      video.onloadeddata = done;
      video.onerror = done;
      if (video.readyState >= 2) done();
      setTimeout(done, 5000);
    });

    let thumbnail = '';
    try {
      await video.play().catch(() => {});
      await new Promise(r => setTimeout(r, 120));
      video.pause();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      }
      video.currentTime = 0;
    } catch (e) {
      console.warn('[VJ AI Video] thumbnail capture failed:', e);
    }

    if (thumbnail) {
      try { mediaLibrary.updateItem(id, { thumbnail }); } catch {}
    }

    try {
      const promptText = (name || '').replace(/^AI:\s*/, '');
      await videoLibrary.addVideo({
        name: name || 'AI Video',
        prompt: promptText,
        thumbnail,
        blob: videoBlob,
      });
    } catch (e) {
      console.warn('[VJ AI Video] videoLibrary.addVideo failed:', e);
    }

    if (src && src !== blobUrl) {
      try { URL.revokeObjectURL(src); } catch {}
    }
  }

  // ---- Selected-deck reactive resolution -----------------------------------
  // When the crossfader is on, the parameter panel / clip-effects panel /
  // shader-input panel follows whichever deck the user last interacted with
  // (selectedDeck). When off, Bank A is canonical. These reactive helpers
  // route all parameter-panel reads to the right state slice.
  $: paramDeck = $vjClipLauncher.crossfaderEnabled ? $vjClipLauncher.selectedDeck : 'A';
  $: paramLayerStates = paramDeck === 'B' ? $vjClipLauncher.bankBLayerStates : $vjClipLauncher.layerStates;
  $: paramClipGrid = paramDeck === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
  $: selectedLayerState = selectedLayerIndex !== null ? paramLayerStates[selectedLayerIndex] : null;

  function vjEffectMediaSource(clip: VJClip): MediaSource | null {
    if (clip.type !== 'effect' || !clip.effectSource) return null;
    return {
      id: clip.id,
      type: 'effect',
      name: clip.name,
      src: clip.src,
      effectSource: clip.effectSource,
    };
  }

  function activeEffectColumn(layerIndex: number): number | null {
    const state = paramLayerStates[layerIndex];
    const activeClip = state?.activeClip;
    if (!activeClip) return null;
    if (state.activeColumn !== null && state.activeColumn !== undefined) {
      return state.activeColumn;
    }
    const col = paramClipGrid[layerIndex]?.findIndex((clip) => clip?.id === activeClip.id) ?? -1;
    return col >= 0 ? col : null;
  }

  function updateActiveEffectClipSource(next: IntegratedEffectSource) {
    if (selectedLayerIndex === null) return;
    const col = activeEffectColumn(selectedLayerIndex);
    if (col === null) return;
    vjClipLauncher.updateClipEffectSource(selectedLayerIndex, col, next, paramDeck);
  }

  function vjEffectControlLayerId(layerIndex: number, deck: VJDeck): string {
    return $vjClipLauncher.crossfaderEnabled
      ? `vj-layer-${layerIndex}-${deck}`
      : `vj-layer-${layerIndex}`;
  }

  // Drive the video-controls polling tick from the selected clip type. Same
  // pattern as LayerPanel's startVideoTick — only run when a video clip is
  // selected, so the rAF loop is dormant for shader/splat/model3d clips.
  $: if (selectedLayerState?.activeClip?.type === 'video' && selectedLayerState.activeClip.videoElement) {
    startVjVideoTick();
  } else {
    stopVjVideoTick();
  }
</script>

<!-- VJ Mode Full Overlay -->
<svelte:window
  onclick={(e) => { const t = e.target as HTMLElement; if (vjFileMenuOpen && !t.closest?.('.vj-file-menu-container')) vjFileMenuOpen = false; }}
/>

{#if $vjClipLauncher.isOpen}
  <div
    class="vj-overlay"
    class:kf-tray-open={$keyframeTimeline.isOpen}
    class:native-underlay={nativePreviewActive}
    class:mac-titlebar-offset={isMac}
  >
    <!-- Header -->
    <div
      class="vj-header"
      class:audio-on={$audioStore.isActive}
      class:frameless-caption={isDesktopApp && !isMac}
      onmousedown={(event) => {
        if (!isDesktopApp || isMac || event.button !== 0) return;
        const t = event.target as HTMLElement | null;
        if (t?.closest('button, a, input, select, textarea, label, [role="button"], .dropdown, .vj-file-menu-container, .vj-win-controls, .vj-audio-strip, .macro-bank, .audio-meter, .stage-mix-btn')) return;
        void invoke('win_drag_start');
        const end = () => {
          void invoke('win_drag_end');
          window.removeEventListener('mouseup', end, true);
          window.removeEventListener('blur', end, true);
        };
        window.addEventListener('mouseup', end, true);
        window.addEventListener('blur', end, true);
      }}
      ondblclick={(event) => {
        if (!isDesktopApp || isMac) return;
        const t = event.target as HTMLElement | null;
        if (t?.closest('button, a, input, select, textarea, label, [role="button"], .dropdown, .vj-file-menu-container, .vj-win-controls, .vj-audio-strip, .macro-bank')) return;
        void invoke('win_drag_end');
        void invoke('win_maximize_toggle');
      }}
    >
      <!-- Lead column: fixed-size left controls, then the MIX/STAGE/MAP
           toggle centred in whatever space is left before the macro bank. -->
      <div class="header-lead">
      <div class="header-left">
        <img src="{import.meta.env.BASE_URL}icon-new.png" alt="Ghost Arcade" class="vj-logo" />
        <!-- File Menu -->
        <div class="vj-file-menu-container">
          <button class="vj-file-menu-btn" class:active={vjFileMenuOpen} onclick={() => vjFileMenuOpen = !vjFileMenuOpen}>
            File
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
          </button>
          {#if vjFileMenuOpen}
            <div class="vj-file-menu-dropdown">
              <button class="vj-menu-item" onclick={() => vjFileAction('new')}>New<span class="vj-menu-sc">Ctrl+N</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('open')}>Open...<span class="vj-menu-sc">Ctrl+O</span></button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('save')}>Save<span class="vj-menu-sc">Ctrl+S</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('saveAs')}>Save As...<span class="vj-menu-sc">Ctrl+Shift+S</span></button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('importPresets')}>Import Presets...</button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('undo')}>Undo<span class="vj-menu-sc">Ctrl+Z</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('redo')}>Redo<span class="vj-menu-sc">Ctrl+Y</span></button>
            </div>
          {/if}
        </div>
        <div class="master-control" title="Master output opacity">
          <span class="master-label">M</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={$vjClipLauncher.masterOpacity}
            oninput={handleMasterOpacityChange}
            class="master-slider"
            data-midi-path="vj:master:opacity"
            data-midi-label="Master Opacity"
            data-midi-min="0"
            data-midi-max="1"
            data-midi-step="0.01"
          />
          <span class="master-value">{Math.round($vjClipLauncher.masterOpacity * 100)}%</span>
        </div>
        <!-- Kill output: matches the mapping-mode blackout icon (circle
             with diagonal slash). Stops every clip on every layer + bank,
             which is the VJ-mode equivalent of "go dark". The previous
             "STOP ALL" pill ate ~110px of header real estate; this icon
             button is 32px and uses the same visual vocabulary so users
             trained on mapping mode recognize it immediately. -->
        <button class="kill-output-btn" onclick={handleStopAll}
          data-midi-path="vj:stopall"
          data-midi-label="Stop All"
          data-midi-mode="toggle"
          title="Stop All Clips (kills output)"
          aria-label="Stop all clips"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>
      </div>

      <div class="header-stage-slot">
      {#if $vjClipLauncher.isLive}
        <div class="header-stage">
          <button class="stage-mix-btn" class:active={!$vjClipLauncher.stageMode && !$vjClipLauncher.mapMode} onclick={() => vjClipLauncher.setSubMode('mix')} title="Raw VJ clip output">MIX</button>
          <button class="stage-mix-btn" class:active={$vjClipLauncher.stageMode} onclick={() => vjClipLauncher.setSubMode('stage')} title="Route VJ content through the active mapping topology">STAGE</button>
          <button class="stage-mix-btn" class:active={$vjClipLauncher.mapMode} onclick={() => vjClipLauncher.setSubMode('map')} title="Preset-only mixer — VJ layer slots hold mapping presets that stack with opacity + blend modes">MAP</button>
        </div>
      {/if}
      </div>
      </div>

      <!-- Macros — 8 user-assignable knobs that each drive any number of
           parameters with per-destination curves and ranges. Beginners
           use pre-loaded "Energy / Drama / Chaos" presets. Pros build
           build-up combinators (one knob ramps speed + bloom + sat at
           once). Right-click a knob → destination editor + learn flow. -->
      <div class="header-macros">
        <MacroKnobBar />
      </div>

      <!-- Right cluster — tight icon grid that mirrors the mapping-mode
           toolbar-right. Order matches mapping (REC → mode toggles → Stage →
           Settings → Back) so users moving between modes find the same
           controls in the same places. Flip-layout was removed; the option
           now lives in Settings → Appearance. -->
      <div class="header-right">
        {#if vjIsRecording}
          <div class="vj-recording-indicator">
            <span class="vj-rec-dot"></span>
            <span class="vj-rec-time">{formatVJRecordingDuration(vjRecordingDuration)}</span>
          </div>
          <button class="vj-stop-rec-btn" onclick={vjStopRecording}>
            Stop Rec
          </button>
        {:else}
          <button class="vj-rec-btn" onclick={vjStartRecording} title="Record Output">
            ● REC
          </button>
        {/if}

        <!-- Same glyph mapping mode's Stage Sim button uses, so the two
             modes read as the same destination. -->
        <button class="minimize-btn stage-sim-btn" onclick={() => window.dispatchEvent(new CustomEvent('open-stage3d'))} title="Open Stage Simulator" aria-label="Open Stage Simulator">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 16.4 12 12l8 4.4-8 4.5-8-4.5Z" />
            <path d="M7.2 14.7V8.6L12 5.5l4.8 3.1v6.1" />
            <path d="M7.2 8.6 12 11.5l4.8-2.9" />
            <path d="M12 5.5v6" />
          </svg>
          Stage Sim
        </button>
        <button class="minimize-btn" onclick={() => window.dispatchEvent(new CustomEvent('open-settings'))} title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="exit-btn" onclick={handleExitVJClick} title="Exit VJ and stop live output">Exit VJ</button>
        {#if isDesktopApp && !isMac}
          <!-- Frameless window controls, mirroring the mapping-mode toolbar's
               top-right cluster (App.svelte). VJ mode hides the mapping
               toolbar entirely, so without these there is no min/maximize/close
               reachable in VJ. -->
          <div class="vj-win-controls">
            <button class="vj-win-ctl" title="Minimize" aria-label="Minimize"
                    onclick={() => invoke('win_minimize')}>
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor"/></svg>
            </button>
            <button class="vj-win-ctl" title="Maximize" aria-label="Maximize"
                    onclick={() => { void invoke('win_maximize_toggle'); }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
            </button>
            <button class="vj-win-ctl vj-win-close" title="Close" aria-label="Close"
                    onclick={() => invoke('win_close')}>
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.2"><path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5"/></svg>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Stage Presets Bar (visible when stage mode active, stays above overlay content) -->
    {#if $vjClipLauncher.stageMode}
      <div class="stage-presets-bar">
        <span class="stage-presets-label">Stage Presets</span>
        <div class="stage-presets-list">
          {#each allStagePresets as preset, presetIdx (preset.id)}
            <button
              class="stage-preset-btn"
              class:active={$vjClipLauncher.stagePresetId === preset.id}
              onclick={() => stageRenamingPresetId !== preset.id && loadStagePresetFromUI(preset)}
              oncontextmenu={(e) => openStageContextMenu(e, preset)}
              title="{preset.name} — double-click name to rename · right-click for Update / Delete"
              data-midi-path={`vj:stage:${presetIdx}`}
              data-midi-label={`Stage Preset: ${preset.name}`}
              data-midi-mode="toggle"
            >
              {#if preset._scope === 'global'}<span class="stage-preset-scope">G</span>{/if}
              {#if preset.thumbnail}
                <img src={preset.thumbnail} alt={preset.name} class="stage-preset-thumb" />
              {/if}
              {#if stageRenamingPresetId === preset.id}
                <input
                  class="stage-preset-name-input"
                  type="text"
                  bind:value={stageRenameValue}
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitStageRename(preset);
                    if (e.key === 'Escape') cancelStageRename();
                  }}
                  onblur={() => commitStageRename(preset)}
                  use:focusOnMount
                />
              {:else}
                <span
                  class="stage-preset-name"
                  ondblclick={(e) => startStageRename(preset, e)}
                  title="Double-click to rename"
                >{preset.name}</span>
              {/if}
            </button>
          {/each}
        </div>
        <button class="stage-preset-save-btn" onclick={() => saveStagePresetWithScope()} title="Save current mapping as a new stage preset">
          + Save
        </button>
        <!-- Update — overwrites the currently-active stage preset
             with the current layers + effects bundle. Only shown
             when a preset is active (no surprise overwrites of the
             "wrong" preset). Two buttons (vs one chameleon) so the
             destructive overwrite isn't reached by muscle memory
             when the user means "save a new one." -->
        {#if $vjClipLauncher.stagePresetId}
          {@const activePreset = allStagePresets.find(p => p.id === $vjClipLauncher.stagePresetId)}
          {#if activePreset}
            <button
              class="stage-preset-update-btn"
              onclick={() => updateStagePresetInPlace(activePreset)}
              title={`Overwrite "${activePreset.name}" with the current layers + effects`}
            >
              ↻ Update
            </button>
          {/if}
        {/if}
        <button class="stage-scope-toggle"
          class:global={stageSaveScope === 'global'}
          onclick={() => stageSaveScope = stageSaveScope === 'project' ? 'global' : 'project'}
          title={stageSaveScope === 'project' ? 'Save to project' : 'Save globally'}
          aria-label={stageSaveScope === 'project' ? 'Save stage preset to project' : 'Save stage preset globally'}>
          {#if stageSaveScope === 'project'}
            <svg class="stage-scope-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path class="scope-fill" d="M3.5 8.2h17v10.2h-17z"/>
              <path class="scope-stroke" d="M3.5 8.2h17v10.2h-17zM5.6 8.2l1.8-3h4.6l1.7 3M7.2 12.2h9.6"/>
            </svg>
          {:else}
            <svg class="stage-scope-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="scope-stroke" cx="12" cy="12" r="8.2"/>
              <path class="scope-stroke" d="M3.8 12h16.4M12 3.8c2 2.3 3 5 3 8.2s-1 5.9-3 8.2M12 3.8c-2 2.3-3 5-3 8.2s1 5.9 3 8.2"/>
            </svg>
          {/if}
        </button>
      </div>
    {/if}

    <!-- (Audio strip merged into the header above as <AudioMeterPanel /> +
         <AudioInputPicker />. Single source of truth — no second tap/tempo,
         no duplicate FFT bars, no two ways to switch audio source.) -->

    <!-- Main Layout -->
    <div class="vj-main" class:tray-collapsed={mediaTrayCollapsed}>
      <!-- Preview Section: Effects (left) | Preview 16:9 (center) | Shader Params + Media (right) -->
      <div class="vj-preview-section" class:reversed={$settings.ui.vjLayoutReversed} style="height: {previewSectionHeight}px">

        <!-- LEFT: Composition / Layer / Clip effects -->
        <div class="effects-panel-vj">
          <div class="effects-tabs">
            <button class="fx-tab" class:active={effectsTab === 'composition'} onclick={() => effectsTab = 'composition'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              Comp
            </button>
            <button class="fx-tab" class:active={effectsTab === 'layer'} onclick={() => effectsTab = 'layer'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              Layer
            </button>
            <button class="fx-tab" class:active={effectsTab === 'clip'} onclick={() => effectsTab = 'clip'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Clip
            </button>
            <button class="fx-tab" class:active={effectsTab === 'stage'} onclick={() => effectsTab = 'stage'} title="Stage Effects — procedural per-slice modulation that animates the bound mapping layers">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="11"/></svg>
              Stage
            </button>
            {#if ($project.wledControllers ?? []).some(controller => controller.enabled)}
              <button class="fx-tab" class:active={effectsTab === 'led'} onclick={() => effectsTab = 'led'} title="LED patterns and performance controls">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3m4 0h3"/></svg>
                LED
              </button>
            {/if}
          </div>

          <div class="effects-panel-content">
            {#if effectsTab === 'led'}
              <LEDFXPanel />
            {:else if effectsTab === 'stage'}
              <!-- Stage Effects — procedural per-slice modulation that
                   drives the brightness of slice-bound mapping layers.
                   Effects live on the active Surface (Surface.effects[]),
                   persist with the project, and tick continuously in
                   the background via the stageEffects store regardless
                   of which workspace is open. -->
              {#if !$activeSurface}
                <div class="no-effects">
                  Build a stage first (open STAGE → draw slices → Apply Stage), then add effects here to animate your slice layers.
                </div>
              {:else}
                {@const effects = $activeSurface.effects ?? []}
                {@const activeId = $activeSurface.activeEffectId ?? 'still'}
                {@const auto = $activeSurface.effectAutomation}
                <div class="effects-info">
                  <span class="effects-info-label">STAGE FX</span>
                  <p class="effects-info-hint">{effects.length} effect{effects.length === 1 ? '' : 's'} on "{$activeSurface.name}" · one runs at a time</p>
                </div>

                <!-- Automation transport — play/pause cycles through
                     auto-cycle-included effects at the configured
                     interval (Beat mode follows audioStore beatPhase). -->
                <div class="stage-auto-bar">
                  <button
                    class="stage-auto-play"
                    class:playing={auto?.playing}
                    onclick={() => surfaceStore.toggleEffectAutomation()}
                    title={auto?.playing ? 'Stop auto-cycle' : 'Start auto-cycle through ↻-included effects'}
                  >{auto?.playing ? '⏸' : '▶'}</button>
                  <select
                    class="stage-auto-mode"
                    value={auto?.mode ?? 'beat'}
                    onchange={(e) => surfaceStore.updateEffectAutomation({ mode: (e.target as HTMLSelectElement).value as 'time' | 'beat' })}
                  >
                    <option value="beat">Beat</option>
                    <option value="time">Time</option>
                  </select>
                  {#if (auto?.mode ?? 'beat') === 'beat'}
                    <input
                      type="number" min="1" max="64" step="1"
                      class="stage-auto-interval"
                      value={auto?.beats ?? 8}
                      onchange={(e) => surfaceStore.updateEffectAutomation({ beats: parseInt((e.target as HTMLInputElement).value) || 8 })}
                      title="Beats per step"
                    />
                    <span class="stage-auto-unit">bts</span>
                  {:else}
                    <input
                      type="number" min="0.5" max="60" step="0.5"
                      class="stage-auto-interval"
                      value={auto?.seconds ?? 4}
                      onchange={(e) => surfaceStore.updateEffectAutomation({ seconds: parseFloat((e.target as HTMLInputElement).value) || 4 })}
                      title="Seconds per step"
                    />
                    <span class="stage-auto-unit">sec</span>
                  {/if}
                </div>

                <!-- Add new effect — dropdown + button so the user
                     picks the type, clicks Add, and the effect
                     appears at the bottom of the list with defaults. -->
                <div class="stage-fx-add">
                  <select bind:value={stageAddType} class="stage-fx-select">
                    {#each STAGE_EFFECT_CATALOG as def (def.type)}
                      <option value={def.type}>{def.icon} {def.label}</option>
                    {/each}
                  </select>
                  <button class="add-effect-btn" onclick={() => surfaceStore.addStageEffect(stageAddType)}>+ Add</button>
                </div>

                <div class="effects-section">
                  <div class="effects-list">
                    {#each effects as eff (eff.id)}
                      {@const def = getEffectDef(eff.type)}
                      {@const isLive = activeId === eff.id}
                      <div class="effect-item" class:live={isLive}>
                        <div class="effect-header" onclick={() => expandedEffectId = expandedEffectId === eff.id ? null : eff.id}>
                          <!-- Live radio — exactly one effect runs at a time. -->
                          <button
                            class="effect-live-radio"
                            class:active={isLive}
                            onclick={(e) => { e.stopPropagation(); toggleStageActiveEffect(eff.id); }}
                            title="Activate this effect (only one runs at a time)"
                          >{isLive ? '◉' : '○'}</button>
                          <span class="effect-name">
                            <span class="stage-fx-icon">{def?.icon ?? '◆'}</span>
                            {def?.label ?? eff.type}
                          </span>
                          <!-- Cycle-include toggle. Auto-cycle visits
                               only ↻-included effects; muting this
                               doesn't deactivate the effect if it's
                               currently live. -->
                          <button
                            class="stage-effect-hold-button"
                            class:active={isLive}
                            class:pressed={!!heldStageEffects[eff.id]}
                            type="button"
                            title={`Hold to show ${def?.label ?? eff.type}`}
                            aria-label={`Hold to show ${def?.label ?? eff.type}`}
                            data-midi-path={`vj:stage-effect:${eff.id}:hold`}
                            data-midi-label={`Stage FX Hold: ${def?.label ?? eff.type}`}
                            data-midi-mode="toggle"
                            data-midi-min="0"
                            data-midi-max="1"
                            data-keyboard-mode="momentary"
                            onpointerdown={(e) => handleStageEffectHoldPointerDown(e, eff.id)}
                            onpointerup={(e) => handleStageEffectHoldPointerEnd(e, eff.id)}
                            onpointercancel={(e) => handleStageEffectHoldPointerEnd(e, eff.id)}
                            onlostpointercapture={(e) => handleStageEffectHoldPointerEnd(e, eff.id)}
                          >
                            <span class="stage-effect-hold-light"></span>
                            <svg class="stage-effect-fire-icon" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12.4 2.8c.6 3.1-.7 4.9-2.2 6.7-1.3 1.5-2.7 3.2-2.7 5.6 0 2.8 2.1 5.1 4.9 5.1s5.1-2.1 5.1-5.2c0-2.5-1.4-4.6-3-6.3-.2 2-1.2 3.1-2.5 3.9.4-2.6.2-6.2.4-9.8Z"/>
                              <path d="M11.8 20.2c-1.5-.6-2.5-1.9-2.5-3.5 0-1.5.8-2.5 1.7-3.6.2 1.4.8 2.4 1.8 3-.1-1.1.1-2.4.8-3.8 1.1 1.2 1.8 2.6 1.8 4.2 0 1.9-1.4 3.3-3.6 3.7Z"/>
                            </svg>
                            <span class="stage-effect-hold-icon">▶</span>
                          </button>
                          <button
                            class="effect-cycle-toggle"
                            class:included={eff.enabled}
                            onclick={(e) => { e.stopPropagation(); surfaceStore.updateStageEffect(eff.id, { enabled: !eff.enabled }); }}
                            title={eff.enabled ? 'In auto-cycle (click to exclude)' : 'Excluded from auto-cycle (click to include)'}
                          >{eff.enabled ? '↻' : '⊘'}</button>
                          <span class="effect-expand">{expandedEffectId === eff.id ? '▼' : '▶'}</span>
                          <button
                            class="effect-delete"
                            onclick={(e) => { e.stopPropagation(); surfaceStore.deleteStageEffect(eff.id); }}
                            title="Remove"
                          >×</button>
                        </div>
                        {#if expandedEffectId === eff.id}
                          <div class="effect-params">
                            <div class="param-row">
                              <span>Opacity</span>
                              <input
                                type="range" min="0" max="1" step="0.01"
                                value={eff.opacity}
                                oninput={(e) => surfaceStore.updateStageEffect(eff.id, {
                                  opacity: parseFloat((e.target as HTMLInputElement).value)
                                })}
                              />
                              <span class="param-val">{eff.opacity.toFixed(2)}</span>
                            </div>
                            {#each def?.paramSpecs ?? [] as spec (spec.key)}
                              <div class="param-row">
                                <span>{spec.label}</span>
                                <input
                                  type="range"
                                  min={spec.min}
                                  max={spec.max}
                                  step={spec.step ?? 0.01}
                                  value={eff.params[spec.key] ?? def?.defaultParams[spec.key] ?? 0}
                                  oninput={(e) => surfaceStore.updateStageEffectParam(eff.id, spec.key,
                                    parseFloat((e.target as HTMLInputElement).value)
                                  )}
                                />
                                <span class="param-val">{(eff.params[spec.key] ?? def?.defaultParams[spec.key] ?? 0).toFixed(2)}</span>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                    {#if effects.length === 0}
                      <div class="no-effects">No effects yet. Pick one above and click <strong>+ Add</strong>.</div>
                    {/if}
                  </div>
                </div>
              {/if}
            {:else if (effectsTab === 'layer' || effectsTab === 'clip') && selectedLayerIndex === null}
              <div class="no-effects">Click a layer to edit effects</div>
            {:else if effectsTab === 'clip' && selectedLayerIndex !== null && paramLayerStates[selectedLayerIndex].activeColumn === null}
              <div class="no-effects">No active clip on layer {selectedLayerIndex + 1}</div>
            {:else}
              <div class="effects-info">
                <span class="effects-info-label">{effectsTabLabel}</span>
                {#if effectsTab === 'composition'}
                  <p class="effects-info-hint">Applied to all output</p>
                {/if}
              </div>
              <div class="effects-section">
                <div class="effects-header">
                  <span>Effects</span>
                  <button class="add-effect-btn" onclick={() => showEffectPicker = true}>+ Add</button>
                </div>
                <div class="effects-list">
                  {#each currentEffects as effect (effect.id)}
                    {@const pendingNativeEffect = nativeEffectPending(effect.type)}
                    <div class="effect-item" class:disabled={!effect.enabled} class:native-pending={pendingNativeEffect}>
                      <div class="effect-header" onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
                        <button class="effect-toggle" class:active={effect.enabled}
                          disabled={pendingNativeEffect && !effect.enabled}
                          title={pendingNativeEffect ? 'Pending native port' : (effect.enabled ? 'Bypass this effect' : 'Enable this effect')}
                          onclick={(e) => { e.stopPropagation(); toggleVJEffectIfNativeReady(effect); }}>
                          {effect.enabled ? '●' : '○'}
                        </button>
                        <span class="effect-name">{effect.type}</span>
                        <span class="effect-expand">{expandedEffectId === effect.id ? '▼' : '▶'}</span>
                        <button class="effect-delete" onclick={(e) => { e.stopPropagation(); deleteEffect(effect.id); }}>×</button>
                      </div>
                      {#if expandedEffectId === effect.id}
                        <div class="effect-params">
                          {#if pendingNativeEffect}
                            <div class="native-effect-lockout">
                              Pending native port. Disable or remove this effect before using it in native v2.
                            </div>
                          {/if}
                          {#if getEffectPresets(effect.type).length > 0}
                            <details open>
                              <summary>Presets</summary>
                              <div class="param-row">
                                <span>Preset</span>
                                <select
                                  value={vjPresetSelection[effect.id] ?? ''}
                                  onchange={(e) => {
                                    vjPresetSelection = { ...vjPresetSelection, [effect.id]: (e.target as HTMLSelectElement).value };
                                  }}
                                >
                                  <option value="">Select preset</option>
                                  {#each getEffectPresets(effect.type) as preset, i}
                                    <option value={String(i)}>{preset.name}</option>
                                  {/each}
                                </select>
                              </div>
                              <div class="param-row">
                                <button class="btn-small" onclick={() => applyVJPreset(effect)}>Apply Preset</button>
                              </div>
                            </details>
                          {/if}

                          <details open>
                            <summary>Controls</summary>
                          <!-- Param renderer mirrors LayerPanel: try
                               effectParamLabels (rich metadata covering
                               every effect with curated min/max/step),
                               fall back to getNumericEffectParams which
                               extracts numeric keys from the renderer's
                               default-params catalog. This eliminates
                               the "no available parameters" pit that
                               older effects with no EFFECT_PARAM_DEFS
                               entry used to fall into.

                               For the 'layer' tab (deck slot effects),
                               numeric params route through EffectParamRow
                               so the user gets the Auto / audio
                               modulation dropdown just like mapping mode.
                               The 'clip' and 'composition' tabs use a
                               simpler slider since their effects don't
                               live on the layer state the audio engine
                               + autoEngine drive. -->
                          {#if (effectParamLabels[effect.type] && Object.keys(effectParamLabels[effect.type]!).length > 0) || getNumericEffectParams(effect.type).length > 0}
                            {@const _paramMeta = effectParamLabels[effect.type]}
                            {@const _fallbackKeys = !_paramMeta ? getNumericEffectParams(effect.type) : []}
                            {#if _paramMeta}
                              {#each Object.entries(_paramMeta) as [paramKey, meta]}
                                {#if meta.type === 'select' && meta.options}
                                  <div class="param-row">
                                    <span class="param-name">{meta.label}</span>
                                    <select
                                      value={(effect.params as Record<string, number>)[paramKey] ?? meta.default}
                                      onchange={(e) => updateEffectParam(effect.id, paramKey, parseFloat((e.target as HTMLSelectElement).value))}
                                      style="flex:1; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:2px 4px; font-size:12px;">
                                      {#each meta.options as opt}
                                        <option value={opt.value}>{opt.label}</option>
                                      {/each}
                                    </select>
                                  </div>
                                {:else if meta.type === 'color' && meta.colorParams}
                                  <div class="param-row">
                                    <span class="param-name">{meta.label}</span>
                                    <input type="color"
                                      value={'#' + [meta.colorParams.r, meta.colorParams.g, meta.colorParams.b].map(k => {
                                        const v = (effect.params as Record<string, number>)[k] ?? 0;
                                        return Math.round(v * 255).toString(16).padStart(2, '0');
                                      }).join('')}
                                      oninput={(e) => {
                                        const hex = (e.target as HTMLInputElement).value;
                                        const r = parseInt(hex.slice(1, 3), 16) / 255;
                                        const g = parseInt(hex.slice(3, 5), 16) / 255;
                                        const b = parseInt(hex.slice(5, 7), 16) / 255;
                                        if (meta.colorParams) {
                                          updateEffectParam(effect.id, meta.colorParams.r, r);
                                          updateEffectParam(effect.id, meta.colorParams.g, g);
                                          updateEffectParam(effect.id, meta.colorParams.b, b);
                                        }
                                      }}
                                      style="flex:0 0 40px; height:22px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer;" />
                                  </div>
                                {:else if effectsTab === 'layer' && selectedLayerIndex !== null}
                                  <EffectParamRow
                                    label={meta.label}
                                    value={(effect.params as Record<string, number>)[paramKey] ?? meta.default}
                                    min={meta.min as number}
                                    max={meta.max as number}
                                    step={meta.step as number}
                                    layerIndex={selectedLayerIndex}
                                    effectId={effect.id}
                                    paramName={paramKey}
                                    target="vj"
                                    vjBank={paramDeck}
                                    displayValue={(v) => (meta.max as number) <= 1 ? (v * 100).toFixed(0) + '%' : v.toFixed(2)}
                                    onChange={(v) => updateEffectParam(effect.id, paramKey, v)}
                                  />
                                {:else}
                                  <!-- Composition / clip tabs: plain slider, no modulation dropdown. -->
                                  {@const val = (effect.params as Record<string, number>)[paramKey] ?? meta.default}
                                  <div class="param-row">
                                    <span class="param-name">{meta.label}</span>
                                    <input type="range" min={meta.min as number} max={meta.max as number} step={meta.step as number} value={val}
                                      oninput={(e) => updateEffectParam(effect.id, paramKey, parseFloat((e.target as HTMLInputElement).value))}
                                      data-midi-path="vj:fx:{effect.id}:{paramKey}"
                                      data-midi-label="{effect.type} {meta.label}"
                                      data-midi-min={meta.min}
                                      data-midi-max={meta.max}
                                      data-midi-step={meta.step} />
                                    <span class="param-value">{val.toFixed((meta.step as number) < 0.1 ? 2 : (meta.step as number) < 1 ? 1 : 0)}</span>
                                  </div>
                                {/if}
                              {/each}
                            {:else}
                              <!-- Fallback: effect has no curated metadata.
                                   Walk the numeric defaults so users still
                                   get sliders (0..1 range, 0.01 step) for
                                   every adjustable param. -->
                              {#each _fallbackKeys as paramKey}
                                {#if effectsTab === 'layer' && selectedLayerIndex !== null}
                                  <EffectParamRow
                                    label={paramKey}
                                    value={(effect.params as Record<string, number>)[paramKey] ?? 0.5}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    layerIndex={selectedLayerIndex}
                                    effectId={effect.id}
                                    paramName={paramKey}
                                    target="vj"
                                    vjBank={paramDeck}
                                    displayValue={(v) => (v * 100).toFixed(0) + '%'}
                                    onChange={(v) => updateEffectParam(effect.id, paramKey, v)}
                                  />
                                {:else}
                                  {@const val = (effect.params as Record<string, number>)[paramKey] ?? 0.5}
                                  <div class="param-row">
                                    <span class="param-name">{paramKey}</span>
                                    <input type="range" min="0" max="1" step="0.01" value={val}
                                      oninput={(e) => updateEffectParam(effect.id, paramKey, parseFloat((e.target as HTMLInputElement).value))} />
                                    <span class="param-value">{(val * 100).toFixed(0)}%</span>
                                  </div>
                                {/if}
                              {/each}
                            {/if}
                          {:else}
                            <div class="param-row"><span class="no-params">No adjustable parameters</span></div>
                          {/if}
                          </details>
                        </div>
                      {/if}
                    </div>
                  {/each}
                  {#if currentEffects.length === 0}
                    <div class="no-effects">No effects - add one above</div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- CENTER: Preview 16:9 (+ stacked deck confidence monitors in split-deck mode) -->
        <div class="preview-wrapper" class:ab-monitoring={deckMonitorsVisible}>
          <div class="preview-layout">
            <div class="preview-container program-preview" class:native-hole={nativePreviewActive} bind:this={previewContainerEl}>
              <canvas bind:this={previewCanvas} class="preview-canvas" class:hidden-for-native={nativePreviewActive}></canvas>
              <div class="preview-label">{deckMonitorsVisible ? 'PROGRAM' : 'OUTPUT PREVIEW'}</div>
            </div>
            {#if deckMonitorsVisible}
              <div class="deck-preview-stack" aria-label="Deck confidence monitors">
                <div
                  class="deck-preview-container deck-monitor-hole"
                  class:deck-live={$vjClipLauncher.crossfaderValue < 0.5}
                  bind:this={deckMonitorAEl}
                >
                  <div class="deck-preview-label">
                    <strong>A</strong>
                    <span>DECK A</span>
                  </div>
                </div>
                <div
                  class="deck-preview-container deck-monitor-hole"
                  class:deck-live={$vjClipLauncher.crossfaderValue >= 0.5}
                  bind:this={deckMonitorBEl}
                >
                  <div class="deck-preview-label">
                    <strong>B</strong>
                    <span>DECK B</span>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- RIGHT: Full-height VJ tray. Uses the shared mapping MediaTray so browser controls stay identical. -->
        <div class="right-panel-vj" class:collapsed={mediaTrayCollapsed}>
          <button
            class="vj-right-tray-toggle"
            onclick={() => mediaTrayCollapsed = !mediaTrayCollapsed}
            title={mediaTrayCollapsed ? 'Open media and controls' : 'Close media and controls'}
            aria-label={mediaTrayCollapsed ? 'Open media and controls' : 'Close media and controls'}
          >
            <svg class="media-tray-glyph" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <path class="ghost-body" d="M14 4.2c-4.25 0-7.5 3.35-7.5 7.7v10l2.55-1.9 2.35 2.05 2.6-2.05 2.6 2.05L18.95 20l2.55 1.9v-10c0-4.35-3.25-7.7-7.5-7.7Z" />
              <circle class="ghost-eye" cx="11.1" cy="12.2" r="1.25" />
              <circle class="ghost-eye" cx="16.9" cy="12.2" r="1.25" />
              <path class="ghost-mouth" d="M12 16.1c1.25.85 2.75.85 4 0" />
            </svg>
            <span class="media-tray-tab-label">media</span>
          </button>

          {#if !mediaTrayCollapsed}
          <div class="vj-right-tray-content">
            <div class="vj-clip-controls-stack">
          <!-- Shader Parameters (above media tabs) -->
          <!-- Performer-driven clips edit their params inside Performer's own
               SHADER tab; showing this panel too would give the user two
               copies, and this one writes to a grid cell the transient clip
               does not occupy, so its edits went nowhere. -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'shader' && selectedLayerState?.activeClip?.shaderCode && showShaderParams && !(selectedLayerState.activeClip as any)._performerOwned}
            {#if selectedClipShaderInputs.length > 0}
              <div class="shader-params-panel">
                <div class="shader-params-panel-header">
                  <span class="shader-params-overlay-title">
                    {selectedLayerState.activeClip.name}
                    <span class="shader-params-layer-badge">L{selectedLayerIndex! + 1}</span>
                    {#if clipIsAudioReady}
                      <span class="audio-ready-badge" title="Audio-reactive shader">♪</span>
                    {/if}
                  </span>
                  <!-- ↺ Reset every shader param to its ISF
                       INPUT.DEFAULT. Sits beside close — matches the
                       per-effect reset button pattern in LayerPanel. -->
                  <button class="shader-params-reset" onclick={resetShaderParamsToDefaults} title="Reset all params to defaults" aria-label="Reset all params to defaults">↺</button>
                  <button class="shader-params-close" onclick={() => showShaderParams = false}>×</button>
                </div>
                <!-- Audio-warn: only show when there's an actual AUDIO
                     source bound to a param (not Auto / not Manual).
                     The warning is specifically about audio uniforms
                     vs the shader's lack of them; "Auto" is a
                     playhead, not audio-reactive, so showing this
                     for an auto-bound param is just noise. -->
                {#if !clipIsAudioReady && selectedClipShaderInputs.some(i => {
                  const kClip = activeClipId ? modulationMap.get(modKeyShader(selectedLayerIndex!, i.NAME, paramDeck, 'vj', activeClipId)) : undefined;
                  const m = kClip ?? modulationMap.get(modKeyShader(selectedLayerIndex!, i.NAME, paramDeck));
                  return m && m.source !== 'manual' && m.source !== 'auto';
                })}
                  <div class="audio-warn">This shader doesn't use audio uniforms — modulation controls parameters only, not the shader's internal audio response.</div>
                {/if}
                <div class="shader-params-panel-list">
                  {#each selectedClipShaderInputs as input (input.NAME)}
                    <!-- Inline the modulationMap lookup so the @const
                         expression's reactive dependency on the store
                         map is visible to Svelte's template tracker.
                         Going through getParamModulation() hid the
                         dependency since Svelte doesn't trace through
                         function bodies — that's why earlier revs
                         didn't re-render after the dropdown change. -->
                    <!-- Prefer the clip-keyed (vjc:) modulation so two
                         different shaders with the same param name
                         (e.g. both have "speed") don't share an auto
                         binding. Falls back to legacy layer-keyed for
                         older mods that haven't been migrated. -->
                    {@const _modKeyClip = activeClipId ? modKeyShader(selectedLayerIndex!, input.NAME, paramDeck, 'vj', activeClipId) : null}
                    {@const _modKey = modKeyShader(selectedLayerIndex!, input.NAME, paramDeck, 'vj')}
                    {@const mod = (_modKeyClip ? modulationMap.get(_modKeyClip) : undefined) ?? modulationMap.get(_modKey)}
                    <!-- Auto state lives on the clip itself (shaderValueAuto sidecar);
                         audio / LFO sources still go through the modulation store.
                         The select value reflects whichever is active — Auto wins
                         if both somehow exist (mutually exclusive in normal flow). -->
                    {@const _shaderAuto = paramLayerStates[selectedLayerIndex!]?.activeClip?.shaderValueAuto?.[input.NAME] as (AutoConfig | undefined)}
                    {@const _currentSource = _shaderAuto ? 'auto' : (mod?.source ?? 'manual')}
                    {@const isModulated = _currentSource !== 'manual'}
                    <div class="shader-param" class:modulated={isModulated} data-modkey={_modKey} data-modsrc={_currentSource}>
                      <div class="shader-param-header">
                        <span class="shader-param-name">{input.LABEL || input.NAME}</span>
                        <button class="mod-source-chip" class:active={isModulated} class:open={modTrayParam === input.NAME}
                          title="Modulation — audio bands, LFO with BPM sync, auto playhead"
                          onclick={(e) => toggleModTray(input.NAME, e.currentTarget as HTMLElement)}
                        >{modSourceLabel(_currentSource, !!_shaderAuto)}</button>
                      </div>
                      {#if input.TYPE === 'float' || input.TYPE === 'event'}
                        <!-- Inline the value read against paramLayerStates
                             so Svelte sees the reactive dependency in the
                             template — going through getShaderParamValue()
                             hid the dep, so the slider thumb didn't move
                             when the modulation engine wrote new values to
                             the active clip. Same pattern fix as the
                             {@const mod = ...} above. -->
                        {@const _baseVal = paramLayerStates[selectedLayerIndex!]?.activeClip?.shaderValues?.[input.NAME] as number | undefined}
                        {@const _sliderVal = typeof _baseVal === 'number' ? _baseVal : ((input.DEFAULT as number) ?? input.MIN ?? 0)}
                        <div class="shader-param-slider">
                          <div class="slider-track-wrap">
                            <input type="range" min={input.MIN ?? 0} max={input.MAX ?? 1} step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200}
                              value={_sliderVal}
                              oninput={(e) => { markUserInteracting(`vj:${selectedLayerIndex}:shader:${input.NAME}`); setShaderParamValue(selectedLayerIndex!, input.NAME, parseFloat((e.target as HTMLInputElement).value)); }} class="param-slider"
                              data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                              data-midi-label="{input.LABEL || input.NAME}"
                              data-midi-min={input.MIN ?? 0}
                              data-midi-max={input.MAX ?? 1}
                              data-midi-step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200} />
                            {#if isModulated && modGhostValues[input.NAME] !== undefined}
                              <div class="mod-ghost" style="left: {((modGhostValues[input.NAME] - (input.MIN ?? 0)) / ((input.MAX ?? 1) - (input.MIN ?? 0))) * 100}%"></div>
                            {/if}
                            <!-- Auto-mode slippers — overlay on the
                                 main slider track. Slipper inputs use
                                 the SAME min/max as the slider above
                                 so the cyan thumb visually aligns
                                 with the slider's actual range, even
                                 for shaders with non-0..1 inputs
                                 (e.g. MIN=-5 MAX=5 used to squish the
                                 slippers into the left 10% of the
                                 track). Internal storage stays as
                                 0..1 fractions; we map to/from the
                                 absolute slider range at the boundary. -->
                            {#if _shaderAuto}
                              {@const _rMin = input.MIN ?? 0}
                              {@const _rMax = input.MAX ?? 1}
                              {@const _rSpan = (_rMax - _rMin) || 1}
                              {@const _aMin = _shaderAuto.min}
                              {@const _aMax = _shaderAuto.max}
                              {@const _aMinFrac = (_aMin - _rMin) / _rSpan}
                              {@const _aMaxFrac = (_aMax - _rMin) / _rSpan}
                              <div class="slipper-fill" style="left: {_aMinFrac * 100}%; right: {(1 - _aMaxFrac) * 100}%"></div>
                              <input type="range" min={_rMin} max={_rMax} step={_rSpan / 200} value={_aMin}
                                class="slipper slipper-min"
                                oninput={(e) => {
                                  const v = parseFloat((e.target as HTMLInputElement).value);
                                  setShaderAutoField(input.NAME, 'min', Math.min(v, _aMax - _rSpan * 0.02));
                                }} />
                              <input type="range" min={_rMin} max={_rMax} step={_rSpan / 200} value={_aMax}
                                class="slipper slipper-max"
                                oninput={(e) => {
                                  const v = parseFloat((e.target as HTMLInputElement).value);
                                  setShaderAutoField(input.NAME, 'max', Math.max(v, _aMin + _rSpan * 0.02));
                                }} />
                            {/if}
                          </div>
                          <span class="param-val">{(isModulated && modGhostValues[input.NAME] !== undefined ? modGhostValues[input.NAME] : _sliderVal).toFixed(2)}</span>
                        </div>
                        <!-- Auto transport / speed moved into the
                             ModTray popover. Range slippers stay on
                             the main slider track above (see .slipper
                             inputs) since they map 1:1 to the param's
                             pixels. -->

                      {:else if input.TYPE === 'bool'}
                        <div class="shader-param-toggle">
                          <button class="bool-toggle" class:on={getShaderParamValue(selectedLayerIndex!, input.NAME, 0) > 0.5}
                            onclick={() => { const cur = getShaderParamValue(selectedLayerIndex!, input.NAME, 0); setShaderParamValue(selectedLayerIndex!, input.NAME, cur > 0.5 ? 0 : 1); }}
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-discrete="true">
                            {getShaderParamValue(selectedLayerIndex!, input.NAME, 0) > 0.5 ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      {:else if input.TYPE === 'long' && input.VALUES && input.LABELS}
                        <div class="shader-param-select">
                          <select class="long-select" value={getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}
                            onchange={(e) => setShaderParamValue(selectedLayerIndex!, input.NAME, parseInt((e.target as HTMLSelectElement).value))}
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-discrete="true">
                            {#each input.VALUES as val, i}<option value={val}>{input.LABELS?.[i] ?? val}</option>{/each}
                          </select>
                        </div>
                      {:else if input.TYPE === 'long'}
                        <div class="shader-param-slider">
                          <input type="range" min={input.MIN ?? 0} max={input.MAX ?? 10} step="1"
                            value={getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}
                            oninput={(e) => setShaderParamValue(selectedLayerIndex!, input.NAME, parseInt((e.target as HTMLInputElement).value))} class="param-slider"
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-min={input.MIN ?? 0}
                            data-midi-max={input.MAX ?? 10}
                            data-midi-step="1" />
                          <span class="param-val">{getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}</span>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>

                <!-- The mod tray — one instance for the whole panel,
                     anchored to whichever param chip was clicked. All
                     depth / invert / LFO speed / BPM-sync / auto
                     transport tuning lives here. -->
                {#if modTrayParam && modTrayAnchor && selectedLayerIndex !== null}
                  {@const _tInput = selectedClipShaderInputs.find(i => i.NAME === modTrayParam)}
                  {@const _tModClipKey = activeClipId ? modKeyShader(selectedLayerIndex, modTrayParam, paramDeck, 'vj', activeClipId) : null}
                  {@const _tMod = (_tModClipKey ? modulationMap.get(_tModClipKey) : undefined) ?? modulationMap.get(modKeyShader(selectedLayerIndex, modTrayParam, paramDeck, 'vj'))}
                  {@const _tAuto = paramLayerStates[selectedLayerIndex]?.activeClip?.shaderValueAuto?.[modTrayParam] as (AutoConfig | undefined)}
                  <ModTray
                    label={_tInput?.LABEL || modTrayParam}
                    anchor={modTrayAnchor}
                    source={_tMod?.source ?? 'manual'}
                    mod={_tMod}
                    auto={_tAuto}
                    onClose={() => modTrayParam = null}
                    onSetSource={(s) => setShaderParamSource(selectedLayerIndex!, modTrayParam!, s, _tInput?.MIN ?? 0, _tInput?.MAX ?? 1)}
                    onPatchMod={(p) => patchShaderMod(modTrayParam!, p)}
                    onPatchAuto={(p) => patchShaderAuto(modTrayParam!, p)}
                  />
                {/if}
              </div>
            {/if}
          {/if}

          <!-- JS Animation Parameters. VJ owns this editor; the embedded
               MediaTray deliberately suppresses Mapping's selected-layer
               parameter panels so stale editors cannot appear below it. -->
          {#if selectedLayerIndex !== null
            && selectedLayerState?.activeClip?.jsAnimation
            && (selectedLayerState.activeClip.type === 'jsanimation' || selectedLayerState.activeClip.type === 'p5js')}
            {@const jsClip = selectedLayerState.activeClip}
            {@const jsAnimation = jsClip.jsAnimation}
            {@const jsParams = jsAnimation?.params ?? []}
            <div class="shader-params-panel js-animation-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {jsClip.name || 'JS Animation'}
                  <span class="shader-params-layer-badge js-animation-badge">
                    {jsClip.type === 'p5js' ? 'P5' : 'JS'}
                  </span>
                  <span class="shader-params-layer-badge">L{selectedLayerIndex + 1}</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                {#if jsParams.length > 0}
                  {#each jsParams as param (param.name)}
                    {@const currentValue = jsAnimation?.paramValues?.[param.name] ?? param.default}
                    <div class="shader-param">
                      <div class="shader-param-header">
                        <span class="shader-param-name">{param.label || param.name}</span>
                      </div>
                      {#if param.type === 'number'}
                        {@const minimum = param.min ?? 0}
                        {@const maximum = param.max ?? 1}
                        {@const numericValue = typeof currentValue === 'number' ? currentValue : Number(param.default) || minimum}
                        <div class="shader-param-slider">
                          <input
                            type="range"
                            min={minimum}
                            max={maximum}
                            step={Math.max((maximum - minimum) / 200, 0.001)}
                            value={numericValue}
                            oninput={(event) => setJSAnimationParamValue(
                              selectedLayerIndex!,
                              param.name,
                              parseFloat((event.target as HTMLInputElement).value)
                            )}
                            class="param-slider"
                            data-midi-path="vj:{selectedLayerIndex}:js:{param.name}"
                            data-midi-label={param.label || param.name}
                            data-midi-min={minimum}
                            data-midi-max={maximum}
                            data-midi-step={Math.max((maximum - minimum) / 200, 0.001)}
                          />
                          <span class="param-val">{numericValue.toFixed(2)}</span>
                        </div>
                      {:else if param.type === 'boolean'}
                        <div class="shader-param-toggle">
                          <button
                            class="bool-toggle"
                            class:on={Boolean(currentValue)}
                            onclick={() => setJSAnimationParamValue(selectedLayerIndex!, param.name, !Boolean(currentValue))}
                            data-midi-path="vj:{selectedLayerIndex}:js:{param.name}"
                            data-midi-label={param.label || param.name}
                            data-midi-discrete="true"
                          >
                            {Boolean(currentValue) ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      {:else if param.type === 'color'}
                        <div class="js-color-param">
                          <input
                            type="color"
                            value={jsAnimationColorHex(currentValue)}
                            oninput={(event) => setJSAnimationParamValue(
                              selectedLayerIndex!,
                              param.name,
                              jsAnimationColorValue((event.target as HTMLInputElement).value)
                            )}
                            aria-label={param.label || param.name}
                          />
                          <span>{jsAnimationColorHex(currentValue).toUpperCase()}</span>
                        </div>
                      {/if}
                    </div>
                  {/each}
                {:else}
                  <div class="js-no-params">This visual has no adjustable parameters.</div>
                {/if}
              </div>
            </div>
          {/if}

          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'gpu'}
            {@const gpuClip = selectedLayerState.activeClip}
            {@const vjGPUContent = gpuClip.gpuLayerContent || createDefaultGPULayerContent()}
            <div class="shader-params-panel gpu-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {gpuClip.name || 'GPU Shader'}
                  <span class="shader-params-layer-badge" style="background: rgba(85, 215, 239, 0.22); color: #6ee7f7;">GPU</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <VJGPUClipPanel
                  content={vjGPUContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipGPUContent(selectedLayerIndex!, updates, paramDeck)}
                />
              </div>
            </div>
          {/if}

          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'text'}
            {@const textClip = selectedLayerState.activeClip}
            {@const vjTextContent = textClip.textContent || createDefaultTextContent()}
            <div class="shader-params-panel text-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {textClip.name || 'Text Creator'}
                  <span class="shader-params-layer-badge" style="background: rgba(244, 114, 182, 0.22); color: #f9a8d4;">TXT</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <VJTextClipPanel
                  content={vjTextContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipTextContent(selectedLayerIndex!, updates, paramDeck)}
                />
              </div>
            </div>
          {/if}

          <!-- Point Cloud (Splat) Parameters — Full controls via reusable SplatPanel -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'splat'}
            {@const splatClip = selectedLayerState.activeClip}
            {@const vjSplatContent = splatClip.splatContent || createDefaultSplatContent()}
            <div class="shader-params-panel splat-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {splatClip.name || 'Point Cloud'}
                  <span class="shader-params-layer-badge" style="background: rgba(52, 211, 153, 0.3); color: #34d399;">PLY</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <SplatPanel
                  content={vjSplatContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipSplatContent(selectedLayerIndex!, updates, paramDeck)}
                  onFileLoad={() => reloadVJClipFile(selectedLayerIndex!, paramLayerStates[selectedLayerIndex!]?.activeColumn ?? 0, paramDeck)}
                  compact={true}
                />
              </div>
            </div>
          {/if}

          <!-- 3D Model Parameters — Full controls via reusable Model3DPanel -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'model3d'}
            {@const modelClip = selectedLayerState.activeClip}
            {@const vjModel3DContent = modelClip.model3dContent || createDefaultModel3DContent()}
            <div class="shader-params-panel model3d-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {modelClip.name || '3D Model'}
                  <span class="shader-params-layer-badge" style="background: rgba(251, 191, 36, 0.3); color: #fbbf24;">3DM</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <Model3DPanel
                  content={vjModel3DContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipModel3DContent(selectedLayerIndex!, updates, paramDeck)}
                  onFileLoad={() => reloadVJClipFile(selectedLayerIndex!, paramLayerStates[selectedLayerIndex!]?.activeColumn ?? 0, paramDeck)}
                  compact={true}
                />
              </div>
            </div>
          {/if}

          <!-- Plugin/Effect Parameters (FluidGen, Particles3D, etc.) -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'effect'}
            {@const effectClip = selectedLayerState.activeClip}
            {@const vjPluginSource = vjEffectMediaSource(effectClip)}
            {#if vjPluginSource}
              <div class="shader-params-panel effect-params-panel">
                <div class="shader-params-panel-list plugin-param-list">
                  <PluginLayerPanel
                    source={vjPluginSource}
                    onUpdateEffectSource={updateActiveEffectClipSource}
                    controlLayerId={vjEffectControlLayerId(selectedLayerIndex, paramDeck)}
                    midiPrefix={paramDeck === 'B' ? `vj-b:${selectedLayerIndex}:plugin` : `vj:${selectedLayerIndex}:plugin`}
                  />
                </div>
              </div>
            {/if}
          {/if}

          <!-- Video Controls Panel (matches LayerPanel mapping-mode controls) -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'video' && selectedLayerState?.activeClip?.videoElement}
            {@const vClip = selectedLayerState.activeClip}
            {@const vEl = vClip.videoElement!}
            {@const vMode = vClip.playbackMode || 'loop'}
            {@const vRate = vClip.playbackRate ?? 1.0}
            {@const vSyncBeats = vClip.playbackSyncBeats ?? null}
            {@const vTrimS = vClip.trimStart ?? 0}
            {@const vTrimE = vClip.trimEnd ?? 1}
            {@const vIsPlaying = vClip.isPlaying !== false}
            {@const vZoom = vClip.zoom ?? 1}
            {@const vFit = vClip.fit ?? 'cover'}
            {@const vAnchorX = vClip.anchorX ?? 0.5}
            {@const vAnchorY = vClip.anchorY ?? 0.5}
            {@const vRotation = vClip.rotation ?? 0}
            {@const vOpacity = vClip.opacity ?? 1}
            {@const vMirrorX = !!vClip.mirrorX}
            {@const vAudioOn = vClip.audioPlayback === true}
            {@const vAudioVolume = vClip.audioVolume ?? 1}
            {@const vAudioMuted = vClip.audioMuted === true}
            {@const vHasAudioTrack = probeHasAudioTrack(vEl)}
            <div class="shader-params-panel video-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {vClip.name || 'Video'}
                  <span class="shader-params-layer-badge" style="background: rgba(96, 165, 250, 0.3); color: #60a5fa;">VID</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <div class="video-controls-panel">
                  <!-- Transport row -->
                  <div class="vt-transport">
                    <button
                      class="vt-btn vt-play"
                      onclick={() => vjSetVideoPlaying(selectedLayerIndex!, !vIsPlaying)}
                      title={vIsPlaying ? 'Pause' : 'Play'}
                      data-midi-path="vj:{selectedLayerIndex}:video:play"
                      data-midi-label="{vClip.name} Play/Pause"
                      data-midi-discrete="true"
                    >
                      {#if !vIsPlaying}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      {:else}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
                      {/if}
                    </button>
                    <button
                      class="vt-btn"
                      onclick={() => vjRestartVideo(selectedLayerIndex!)}
                      title="Restart"
                      data-midi-path="vj:{selectedLayerIndex}:video:restart"
                      data-midi-label="{vClip.name} Restart"
                      data-midi-discrete="true"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                      </svg>
                    </button>
                    <span class="vt-time">{vjFormatTime(vjVideoCurrentTime)} / {vjFormatTime(vjVideoDuration)}</span>
                    <select
                      class="vt-speed"
                      value={String(vRate)}
                      onchange={(e) => vjSetPlaybackRate(selectedLayerIndex!, parseFloat((e.target as HTMLSelectElement).value))}
                      disabled={!!vSyncBeats}
                      title={vSyncBeats ? 'Speed is locked to beat/bar sync' : 'Playback speed'}
                    >
                      <option value="0.25">0.25x</option>
                      <option value="0.5">0.5x</option>
                      <option value="1">1x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2x</option>
                      <option value="4">4x</option>
                    </select>
                    <select
                      class="vt-speed"
                      value={vSyncBeats ? String(vSyncBeats) : ''}
                      onchange={(e) => {
                        const raw = (e.target as HTMLSelectElement).value;
                        vjSetPlaybackSync(selectedLayerIndex!, raw ? parseFloat(raw) : null);
                      }}
                      title="Fit this video to the master BPM"
                    >
                      <option value="">Free</option>
                      <option value="1">1 beat</option>
                      <option value="2">2 beats</option>
                      <option value="4">1 bar</option>
                      <option value="8">2 bars</option>
                      <option value="16">4 bars</option>
                    </select>
                  </div>

                  <!-- Timeline bar -->
                  <div
                    class="vt-timeline"
                    bind:this={vjTimelineEl}
                    onmousedown={(e) => vjHandleTimelineMouseDown(e, vEl)}
                    role="slider"
                    tabindex="0"
                    aria-label="Video timeline"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={vjVideoDuration > 0 ? Math.round(vjVideoCurrentTime / vjVideoDuration * 100) : 0}
                  >
                    <!-- Grayed areas outside trim -->
                    <div class="vt-trim-outside-left" style="width: {vTrimS * 100}%"></div>
                    <div class="vt-trim-outside-right" style="width: {(1 - vTrimE) * 100}%"></div>
                    <!-- Active trim region -->
                    <div class="vt-trim-region" style="left: {vTrimS * 100}%; width: {(vTrimE - vTrimS) * 100}%"></div>
                    <!-- Playhead -->
                    {#if vjVideoDuration > 0}
                      <div class="vt-playhead" style="left: {(vjVideoCurrentTime / vjVideoDuration) * 100}%"></div>
                    {/if}
                    <!-- Trim handles -->
                    <div
                      class="vt-trim-handle vt-trim-start"
                      style="left: {vTrimS * 100}%"
                      onmousedown={(e) => vjHandleTrimMouseDown(e, 'start', selectedLayerIndex!)}
                      role="slider"
                      tabindex="0"
                      aria-label="Trim start"
                    ></div>
                    <div
                      class="vt-trim-handle vt-trim-end"
                      style="left: {vTrimE * 100}%"
                      onmousedown={(e) => vjHandleTrimMouseDown(e, 'end', selectedLayerIndex!)}
                      role="slider"
                      tabindex="0"
                      aria-label="Trim end"
                    ></div>
                  </div>

                  <!-- Mode buttons row -->
                  <div class="vt-modes">
                    <button class="vt-mode-btn" class:active={vMode === 'loop'} onclick={() => vjSetPlaybackMode(selectedLayerIndex!, 'loop')} title="Loop">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                      </svg>
                      Loop
                    </button>
                    <button class="vt-mode-btn" class:active={vMode === 'once'} onclick={() => vjSetPlaybackMode(selectedLayerIndex!, 'once')} title="Play Once">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      Once
                    </button>
                  </div>

                  <!-- Audio: OPT-IN, default off. Turning this on is the only
                       thing in the app that un-mutes a media element. It gives
                       the clip a dedicated (non-pooled) <video> wired into
                       clipAudioBus, which chases the native core's render
                       clock. Off = exactly today's behaviour: silent, no
                       AudioContext work, no second decoder. -->
                  <div class="vt-transform vt-audio">
                    <div class="vt-section-title">Audio</div>

                    <label class="vt-tf-row vt-tf-toggle-row">
                      <span class="vt-tf-label">Play audio</span>
                      <button
                        class="vt-toggle-btn"
                        class:active={vAudioOn}
                        onclick={() => vjSetClipAudioPlayback(selectedLayerIndex!, !vAudioOn)}
                        title={vHasAudioTrack === false
                          ? 'This file has no audio track'
                          : 'Play this clip’s audio track through the master output'}
                        data-midi-path="vj:{selectedLayerIndex}:video:audio"
                        data-midi-label="{vClip.name} Audio"
                        data-midi-discrete="true"
                      >
                        {vAudioOn ? 'On' : 'Off'}
                      </button>
                    </label>

                    {#if vHasAudioTrack === false}
                      <div class="vt-audio-note">No audio track detected in this file.</div>
                    {/if}

                    {#if vAudioOn}
                      <label class="vt-tf-row">
                        <span class="vt-tf-label">Volume</span>
                        <input
                          type="range"
                          min="0" max="1" step="0.01"
                          value={vAudioVolume}
                          disabled={vAudioMuted}
                          oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { audioVolume: +(e.target as HTMLInputElement).value }, paramDeck)}
                          data-midi-path="vj:{selectedLayerIndex}:video:audioVolume"
                          data-midi-label="{vClip.name} Audio Volume"
                        />
                        <span class="vt-tf-num">{Math.round(vAudioVolume * 100)}%</span>
                      </label>

                      <label class="vt-tf-row vt-tf-toggle-row">
                        <span class="vt-tf-label">Mute</span>
                        <button
                          class="vt-toggle-btn"
                          class:active={vAudioMuted}
                          onclick={() => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { audioMuted: !vAudioMuted }, paramDeck)}
                          title="Duck this clip without losing its volume setting"
                          data-midi-path="vj:{selectedLayerIndex}:video:audioMute"
                          data-midi-label="{vClip.name} Audio Mute"
                          data-midi-discrete="true"
                        >
                          {vAudioMuted ? 'Muted' : 'Live'}
                        </button>
                      </label>
                    {/if}
                  </div>

                  <!-- Per-clip transform: zoom, fit, anchor, rotation, opacity.
                       Maps to VJClip.zoom/fit/anchorX/anchorY/rotation/opacity
                       which Layer construction in vjOutputLayers translates to
                       the engine's existing position/scale/rotation/opacity/
                       contentFit fields. Each input writes immediately via
                       vjClipLauncher.updateActiveClipVideoProps so the change
                       is visible on the next frame. -->
                  <div class="vt-transform">
                    <div class="vt-section-title">Transform</div>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Fit</span>
                      <select
                        class="vt-tf-select"
                        value={vFit}
                        onchange={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { fit: (e.target as HTMLSelectElement).value as any }, paramDeck)}
                      >
                        <option value="cover">Cover (fill + crop)</option>
                        <option value="contain">Contain (letterbox)</option>
                        <option value="fill">Fill (stretch)</option>
                      </select>
                    </label>

                    <label class="vt-tf-row vt-tf-toggle-row">
                      <span class="vt-tf-label">Mirror</span>
                      <button
                        class="vt-toggle-btn"
                        class:active={vMirrorX}
                        onclick={() => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { mirrorX: !vMirrorX }, paramDeck)}
                        title="Mirror horizontally"
                        data-midi-path="vj:{selectedLayerIndex}:video:mirror"
                        data-midi-label="{vClip.name} Mirror"
                        data-midi-discrete="true"
                      >
                        {vMirrorX ? 'On' : 'Off'}
                      </button>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Zoom</span>
                      <input
                        type="range"
                        min="0.1" max="4" step="0.05"
                        value={vZoom}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { zoom: +(e.target as HTMLInputElement).value }, paramDeck)}
                      />
                      <span class="vt-tf-num">{vZoom.toFixed(2)}×</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Anchor X</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={vAnchorX}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { anchorX: +(e.target as HTMLInputElement).value }, paramDeck)}
                      />
                      <span class="vt-tf-num">{vAnchorX.toFixed(2)}</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Anchor Y</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={vAnchorY}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { anchorY: +(e.target as HTMLInputElement).value }, paramDeck)}
                      />
                      <span class="vt-tf-num">{vAnchorY.toFixed(2)}</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Rotation</span>
                      <input
                        type="range"
                        min="-180" max="180" step="1"
                        value={vRotation}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { rotation: +(e.target as HTMLInputElement).value }, paramDeck)}
                      />
                      <span class="vt-tf-num">{vRotation}°</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Opacity</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={vOpacity}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { opacity: +(e.target as HTMLInputElement).value }, paramDeck)}
                      />
                      <span class="vt-tf-num">{Math.round(vOpacity * 100)}%</span>
                    </label>

                    <button
                      class="vt-tf-reset"
                      onclick={() => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { zoom: 1, fit: 'cover', anchorX: 0.5, anchorY: 0.5, rotation: 0, opacity: 1, mirrorX: false }, paramDeck)}
                      title="Reset transform to defaults"
                    >
                      Reset transform
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {/if}
            </div>
            <div class="vj-shared-media-host">
              <MediaTray
                embedded={true}
                vjMode={true}
                onVJAddPayload={addMediaTrayPayloadToDeck}
                onVJLiveSourcesChange={handleMediaTrayLiveSourcesChange}
                isVJLiveSourceInUse={isMediaTrayLiveSourceInUse}
              />
            </div>
          </div>
          {/if}
      </div>
      </div>

      <!-- Resize handle for preview section -->
      <div
        class="preview-resize-handle"
        onpointerdown={onPreviewResizeStart}
        onpointermove={onPreviewResizeMove}
        onpointerup={onPreviewResizeEnd}
        onpointercancel={onPreviewResizeEnd}
      >
        <div class="resize-grip"></div>
      </div>

      <!-- Bottom Section: Grid + Media Tray -->
      <div class="vj-bottom">
      <!-- Clip Grid (now takes more space without left panel) -->
      <div class="grid-section" class:reversed={$settings.ui.vjLayoutReversed}>
        <!-- Blocks Tab Bar -->
        <div class="blocks-tab-bar">
          <div class="blocks-tabs">
            {#each $vjClipLauncher.blocks as block, blockIdx (block.id)}
              <div
                class="block-tab"
                class:active={$vjClipLauncher.activeBlockId === block.id}
                class:dragover={dragOverBlockIndex === blockIdx}
                draggable={editingBlockId !== block.id}
                onclick={() => handleSelectBlock(block.id)}
                ondblclick={(e) => startEditingBlock(block, e)}
                oncontextmenu={(e) => openBlockContextMenu(e, block.id)}
                ondragstart={(e) => handleBlockDragStart(e, blockIdx)}
                ondragover={(e) => handleBlockDragOver(e, blockIdx)}
                ondrop={(e) => handleBlockDrop(e, blockIdx)}
                ondragend={handleBlockDragEnd}
                role="tab"
                tabindex="0"
                data-midi-path="vj:block:{blockIdx}"
                data-midi-label="Block {blockIdx + 1}: {block.name}"
                data-midi-mode="toggle"
              >
                {#if editingBlockId === block.id}
                  <input
                    bind:this={blockInputEl}
                    type="text"
                    class="block-name-input"
                    bind:value={editingBlockName}
                    onblur={finishEditingBlock}
                    onkeydown={handleBlockKeyDown}
                    onclick={(e) => e.stopPropagation()}
                  />
                {:else}
                  <span class="block-name">{block.name}</span>
                {/if}
                {#if $vjClipLauncher.blocks.length > 1}
                  <button
                    class="block-delete-btn"
                    onclick={(e) => handleDeleteBlock(block.id, e)}
                    title="Delete block"
                  >
                    x
                  </button>
                {/if}
              </div>
            {/each}
          </div>
          <button class="add-block-btn" onclick={handleAddBlock} title="Add new block">
            +
          </button>
          <div class="grid-snaps">
            <SnapshotBank placement="inline" />
          </div>
        </div>

        <!-- Grid dimension controls -->
        <div class="grid-dimension-controls">
          <div class="dim-group">
            <span class="dim-label">Layers</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.removeLayer()} title="Remove layer">−</button>
            <span class="dim-value">{$vjClipLauncher.numLayers}</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.addLayer()} title="Add layer">+</button>
          </div>
          <div class="dim-group">
            <span class="dim-label">Columns</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.removeColumn()} title="Remove column">−</button>
            <span class="dim-value">{$vjClipLauncher.numColumns}</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.addColumn()} title="Add column">+</button>
          </div>
        </div>

        <!-- ====================================================================
             DECK SNIPPET: renders one full deck (column triggers + layer rows
             + cells), parameterized by `bank`. In single-deck mode it's
             rendered once with bank='A'. When the crossfader is enabled, it
             renders TWICE — once per deck — with a vertical fader strip
             between. Each deck reads its own clipGrid + layerStates and
             writes through to the matching bank in the store.
             ==================================================================== -->
        {#snippet deckUI(bank: VJDeck)}
          {@const grid = bank === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid}
          {@const states = bank === 'B' ? $vjClipLauncher.bankBLayerStates : $vjClipLauncher.layerStates}
          {@const isSelectedDeck = !$vjClipLauncher.crossfaderEnabled || $vjClipLauncher.selectedDeck === bank}
          {@const midiPrefix = bank === 'B' ? 'vj-b' : 'vj'}

          <!-- Column headers (per-deck — column triggers fire only on this deck) -->
          <div class="column-headers">
            <div class="live-preview-header">LIVE</div>
            <div class="layer-controls-header"></div>
            {#each columnIndices as colIdx (colIdx)}
              <button
                class="column-trigger"
                onclick={() => handleColumnTrigger(colIdx, bank)}
                title={`Trigger column ${colIdx + 1} on Deck ${bank}`}
                data-midi-path="{midiPrefix}:column:{colIdx}"
                data-midi-label="Deck {bank} Column {colIdx + 1}"
                data-midi-mode="toggle"
              >
                {colIdx + 1}
              </button>
            {/each}
          </div>

          <!-- Layer rows -->
          {#each layerIndices as layerIdx (layerIdx)}
            {@const activeClip = states[layerIdx].activeClip}
            <div
              class="layer-row"
              class:selected={isSelectedDeck && selectedLayerIndex === layerIdx}
              class:dragging={draggedLayerIndex === layerIdx}
              class:drag-over={dragOverLayerIndex === layerIdx}
              ondragover={(e) => handleLayerDragOver(layerIdx, e)}
              ondragleave={handleLayerDragLeave}
              ondrop={(e) => handleLayerDrop(layerIdx, e, bank)}
            >
              <!-- Live Preview Thumbnail (drag handle for layer reorder) -->
              <div class="layer-live-preview" class:has-clip={activeClip !== null}
                draggable="true"
                ondragstart={(e) => handleLayerDragStart(layerIdx, e)}
                ondragend={handleLayerDragEnd}
                title="Drag to reorder layer"
              >
                {#if activeClip}
                  {#if activeClip.thumbnail}
                    <img src={activeClip.thumbnail} alt={activeClip.name} class="live-preview-thumb" />
                  {:else}
                    <div class="live-preview-placeholder {activeClip.type}">
                      {activeClip.type === 'shader' ? 'ISF' : activeClip.type === 'video' ? 'VID' : activeClip.type === 'spout' ? 'SPT' : activeClip.type === 'threejs' ? '3JS' : activeClip.type === 'synthvision' ? 'PERF' : 'IMG'}
                    </div>
                  {/if}
                  <div class="live-indicator-dot"></div>
                {:else}
                  <div class="live-preview-empty">-</div>
                {/if}
              </div>

              <!-- Layer controls -->
              <div class="layer-controls" draggable="false"
                ondragstart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onclick={() => { selectLayerForEffects(layerIdx); if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank); }}>
                <div class="layer-header">
                  <button class="layer-select-icon" class:selected={isSelectedDeck && selectedLayerIndex === layerIdx}
                    onclick={(e) => { e.stopPropagation(); selectLayerForEffects(layerIdx); if ($vjClipLauncher.crossfaderEnabled) vjClipLauncher.setSelectedDeck(bank); }}
                    title="Select layer {layerIdx + 1} on Deck {bank}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/></svg>
                  </button>
                  <span class="layer-num">{layerIdx + 1}</span>
                  <div class="layer-buttons">
                    <button
                      class="layer-btn solo"
                      class:active={states[layerIdx].solo}
                      onclick={(e) => { e.stopPropagation(); handleToggleSolo(layerIdx, bank); }}
                      title="Solo (Deck {bank})"
                      data-midi-path="{midiPrefix}:{layerIdx}:solo"
                      data-midi-label="Deck {bank} L{layerIdx + 1} Solo"
                      data-midi-mode="toggle"
                    >S</button>
                    <button
                      class="layer-btn mute"
                      class:active={states[layerIdx].mute}
                      onclick={(e) => { e.stopPropagation(); handleToggleMute(layerIdx, bank); }}
                      title="Mute (Deck {bank})"
                      data-midi-path="{midiPrefix}:{layerIdx}:mute"
                      data-midi-label="Deck {bank} L{layerIdx + 1} Mute"
                      data-midi-mode="toggle"
                    >M</button>
                    <button
                      class="layer-btn stop"
                      onclick={(e) => { e.stopPropagation(); handleStopLayer(layerIdx, bank); }}
                      title="Stop layer (Deck {bank})"
                    >■</button>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={states[layerIdx].opacity}
                  oninput={(e) => handleLayerOpacityChange(layerIdx, e, bank)}
                  class="opacity-slider"
                  draggable="false"
                  onmousedown={(e) => e.stopPropagation()}
                  onclick={(e) => e.stopPropagation()}
                  onpointerdown={(e) => e.stopPropagation()}
                  data-midi-path="{midiPrefix}:{layerIdx}:opacity"
                  data-midi-label="Deck {bank} L{layerIdx + 1} Opacity"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <select
                  class="blend-select"
                  value={states[layerIdx].blendMode}
                  onchange={(e) => handleLayerBlendChange(layerIdx, e, bank)}
                  onclick={(e) => e.stopPropagation()}
                  data-midi-path="{midiPrefix}:{layerIdx}:blend"
                  data-midi-label="Deck {bank} L{layerIdx + 1} Blend"
                  data-midi-discrete="true"
                >
                  {#each blendModes as mode}
                    <option value={mode}>{mode}</option>
                  {/each}
                </select>
              </div>

              <!-- Clip cells -->
              {#each columnIndices as colIdx (colIdx)}
                {@const clip = grid[layerIdx]?.[colIdx]}
                {@const isActive = activeClip !== null && clip != null && activeClip.id === clip.id}
                {@const isPresetActive = clip != null && clip.type === 'preset' && clip.presetId === $activeCompositionId}
                {@const isQueued = $vjClipLauncher.pendingTriggers.some(p => p.layerIndex === layerIdx && p.columnIndex === colIdx && p.bank === bank)}
                {@const isClipFirable = clip == null || (clip.type === 'preset' ? $vjClipLauncher.mapMode : !$vjClipLauncher.mapMode)}
                <div
                  class="clip-cell"
                  class:has-clip={clip != null}
                  class:active={isActive || isPresetActive}
                  class:queued={isQueued}
                  class:dragover={dragOverCell?.layer === layerIdx && dragOverCell?.column === colIdx && dragOverCell?.bank === bank}
                  class:wrong-mode={clip != null && !isClipFirable}
                  draggable={clip != null ? 'true' : 'false'}
                  onclick={(e) => clip && isClipFirable && handleCellClickEvent(e, layerIdx, colIdx, bank)}
                  onpointerdown={(e) => clip && isClipFirable && handleCellPointerDown(e, layerIdx, colIdx, bank)}
                  onpointermove={handleCellPointerMove}
                  onpointerup={(e) => clip && isClipFirable && handleCellPointerUp(e, layerIdx, colIdx, bank)}
                  onpointercancel={handleCellPointerCancel}
                  onkeydown={(e) => clip && isClipFirable && handleCellKeyDown(e, layerIdx, colIdx, bank)}
                  ondragstart={(e) => clip && handleClipCellDragStart(e, layerIdx, colIdx, bank)}
                  ondragend={handleDragEnd}
                  ondragenter={(e) => handleCellDragOver(e, layerIdx, colIdx, bank)}
                  ondragover={(e) => handleCellDragOver(e, layerIdx, colIdx, bank)}
                  ondragleave={handleCellDragLeave}
                  ondrop={(e) => handleCellDrop(e, layerIdx, colIdx, bank)}
                  oncontextmenu={(e) => handleCellContextMenu(e, layerIdx, colIdx, bank)}
                  role="button"
                  tabindex="0"
                  data-midi-path="{midiPrefix}:{layerIdx}:trigger:{colIdx}"
                  data-midi-label="Deck {bank} L{layerIdx + 1} C{colIdx + 1}"
                  data-midi-mode="toggle"
                >
                  {#if clip}
                    <div class="clip-content">
                      {#if clip.thumbnail}
                        <img src={clip.thumbnail} alt={clip.name} class="clip-thumb" />
                      {:else}
                        <div class="clip-placeholder {clip.type}">
                          {clip.type === 'shader' ? 'ISF' : clip.type === 'video' ? 'VID' : clip.type === 'spout' ? 'SPT' : clip.type === 'threejs' ? '3JS' : clip.type === 'splat' ? 'PLY' : clip.type === 'model3d' ? '3DM' : clip.type === 'gpu' ? 'GPU' : clip.type === 'text' ? 'TXT' : clip.type === 'effect' ? 'FX' : clip.type === 'preset' ? 'MAP' : clip.type === 'synthvision' ? 'PERF' : 'IMG'}
                        </div>
                      {/if}
                      <span class="clip-name">{clip.name}</span>
                      <button class="clear-btn" onclick={(e) => handleClearClip(layerIdx, colIdx, e, bank)}>×</button>
                    </div>
                  {:else}
                    <div class="empty-cell"></div>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        {/snippet}

        <!-- Render single deck or dual decks based on crossfader state -->
        {#if $vjClipLauncher.crossfaderEnabled}
          <div class="dual-decks">
            <div class="deck-wrapper deck-a" class:focused={$vjClipLauncher.selectedDeck === 'A'}>
              <div class="deck-label">DECK A</div>
              {@render deckUI('A')}
            </div>

            <!-- Vertical crossfader strip between the two decks -->
            <div class="crossfader-strip">
              <div class="xfade-mod-row">
                <span class="xfade-mod-label">XFADE</span>
                <button
                  class="mod-source-chip xfade-mod-chip"
                  class:active={crossfaderModActive}
                  class:open={crossfaderModTrayAnchor !== null}
                  class:auto={!!crossfaderAuto}
                  title="Crossfader modulation - audio bands, LFO with BPM sync, auto playhead"
                  onclick={(e) => toggleCrossfaderModTray(e.currentTarget as HTMLElement)}
                >{modSourceLabel(crossfaderCurrentSource, !!crossfaderAuto)}</button>
              </div>
              <button
                class="cut-btn cut-a"
                class:active={$vjClipLauncher.crossfaderValue === 0}
                onclick={() => glideCrossfaderTo(0)}
                title="Cut to Deck A"
                data-midi-path="vj:crossfader:cut-a"
                data-midi-label="Cut to Deck A"
                data-midi-mode="toggle"
              >◀</button>
              <div class="xfade-vertical-track">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={1 - $vjClipLauncher.crossfaderValue}
                  oninput={(e) => setCrossfaderManualValue(1 - parseFloat((e.target as HTMLInputElement).value))}
                  class="xfade-vertical-input"
                  data-midi-path="vj:crossfader:value"
                  data-midi-label="Crossfader"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.001"
                />
                <div class="xfade-vertical-rail" aria-hidden="true"></div>
                <div
                  class="xfade-vertical-knob"
                  style={`top: clamp(9px, ${$vjClipLauncher.crossfaderValue * 100}%, calc(100% - 9px));`}
                  aria-hidden="true"
                ></div>
              </div>
              <button
                class="cut-btn cut-b"
                class:active={$vjClipLauncher.crossfaderValue === 1}
                onclick={() => glideCrossfaderTo(1)}
                title="Cut to Deck B"
                data-midi-path="vj:crossfader:cut-b"
                data-midi-label="Cut to Deck B"
                data-midi-mode="toggle"
              >▶</button>

              <div class="xfade-readout">{Math.round($vjClipLauncher.crossfaderValue * 100)}%</div>

              <label class="xfade-time-control" title="Fade time for Cut A/B buttons">
                <span>TIME</span>
                <select
                  class="xfade-select xfade-time"
                  value={$vjClipLauncher.crossfaderFadeDuration ?? 0}
                  onchange={(e) => vjClipLauncher.setCrossfaderFadeDuration(parseFloat((e.target as HTMLSelectElement).value))}
                  data-midi-path="vj:crossfader:fadeDuration"
                  data-midi-label="Crossfader Fade Time"
                  data-midi-discrete="true"
                >
                  <option value={0}>0s</option>
                  <option value={0.25}>0.25s</option>
                  <option value={0.5}>0.5s</option>
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={4}>4s</option>
                  <option value={8}>8s</option>
                </select>
              </label>

              <select
                class="xfade-select"
                value={$vjClipLauncher.crossfaderTransition}
                onchange={(e) => vjClipLauncher.setCrossfaderTransition((e.target as HTMLSelectElement).value as any)}
                title="Transition style"
                data-midi-path="vj:crossfader:transition"
                data-midi-label="Crossfader Transition"
                data-midi-discrete="true"
              >
                <option value="dissolve">Dissolve</option>
                <option value="wipe">Wipe</option>
                <option value="rgb-split">RGB Split</option>
                <option value="cube">Cube</option>
                <option value="shatter">Shatter</option>
                <option value="halftone">Halftone</option>
                <option value="glitch">Glitch</option>
                <option value="liquid">Liquid</option>
                <option value="strobe">Strobe</option>
                <option value="slide">Slide</option>
              </select>

              <!-- Output blend mode for the dual-deck composite. The
                   transition shader (dissolve/wipe/etc.) above shapes the
                   *journey* A↔B; this dropdown picks the *math* used to
                   combine A and B at the mix point. 'normal' = transition
                   output verbatim. multiply/screen/add/etc. replace it
                   with a triangular sweep A → blend(A,B) → B.
                   Replaces the old curve dropdown — operators rarely
                   touched the curve and the blend mode is a creative knob. -->
              <select
                class="xfade-select xfade-curve"
                value={$vjClipLauncher.crossfaderBlendMode || 'normal'}
                onchange={(e) => vjClipLauncher.setCrossfaderBlendMode((e.target as HTMLSelectElement).value as any)}
                title="Output blend mode — A↔B combination math at the mix point"
                data-midi-path="vj:crossfader:blendMode"
                data-midi-label="Crossfader Blend Mode"
                data-midi-discrete="true"
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="add">Add</option>
                <option value="difference">Difference</option>
                <option value="darken">Darken</option>
                <option value="lighten">Lighten</option>
                <option value="overlay">Overlay</option>
                <option value="exclusion">Exclusion</option>
              </select>

              {#if crossfaderModTrayAnchor}
                <ModTray
                  label="A/B Crossfader"
                  anchor={crossfaderModTrayAnchor}
                  source={crossfaderMod?.source ?? 'manual'}
                  mod={crossfaderMod}
                  auto={crossfaderAuto}
                  autoHint="Auto sweeps the A/B fader between Deck A and Deck B."
                  onClose={() => crossfaderModTrayAnchor = null}
                  onSetSource={setCrossfaderSource}
                  onPatchMod={patchCrossfaderMod}
                  onPatchAuto={patchCrossfaderAuto}
                />
              {/if}
            </div>

            <div class="deck-wrapper deck-b" class:focused={$vjClipLauncher.selectedDeck === 'B'}>
              <div class="deck-label">DECK B</div>
              {@render deckUI('B')}
            </div>
          </div>
        {:else}
          {@render deckUI('A')}
        {/if}
      </div>

      <!-- Clip Context Menu — bound to the deck the right-click came from -->
      {#if cellContextMenu}
        {@const ctxClip = deckGrid(cellContextMenu.bank)[cellContextMenu.layer]?.[cellContextMenu.column]}
        <div class="ctx-backdrop" onclick={closeCellContextMenu}></div>
        <div class="ctx-menu" style="left:{cellContextMenu.x}px;top:{cellContextMenu.y}px">
          {#if ctxClip}
            <button class="ctx-item" onclick={openClipPreview}>Edit / Preview</button>
            <button class="ctx-item" onclick={copyClipToClipboard}>Copy</button>
          {/if}
          {#if clipboardClip}
            <button class="ctx-item" onclick={pasteClipFromClipboard}>Paste</button>
          {/if}
          {#if ctxClip}
            <button class="ctx-item ctx-danger" onclick={clearClipFromMenu}>Clear</button>
          {/if}
          {#if !ctxClip && !clipboardClip}
            <div class="ctx-item ctx-disabled">No actions</div>
          {/if}
        </div>
      {/if}

      <!-- Block tab context menu — Save Project + Rename / Duplicate / Delete -->
      {#if blockContextMenu}
        <div class="ctx-backdrop" onclick={closeBlockContextMenu}></div>
        <div class="ctx-menu" style="left:{blockContextMenu.x}px;top:{blockContextMenu.y}px">
          <button class="ctx-item ctx-primary" onclick={blockMenuSaveProject}>
            Save Project<span class="ctx-shortcut">Ctrl+S</span>
          </button>
          <div class="ctx-separator"></div>
          <button class="ctx-item" onclick={blockMenuRename}>Rename Block</button>
          <button class="ctx-item" onclick={blockMenuDuplicate}>Duplicate Block</button>
          {#if $vjClipLauncher.blocks.length > 1}
            <button class="ctx-item ctx-danger" onclick={blockMenuDelete}>Delete Block</button>
          {/if}
        </div>
      {/if}

      <!-- Stage preset context menu — Update / Rename / Delete + Save Project -->
      {#if stageContextMenu}
        <div class="ctx-backdrop" onclick={closeStageContextMenu}></div>
        <div class="ctx-menu" style="left:{stageContextMenu.x}px;top:{stageContextMenu.y}px">
          <button class="ctx-item ctx-primary" onclick={stageMenuUpdate}>
            Update Preset
          </button>
          <button class="ctx-item" onclick={stageMenuRename}>Rename Preset</button>
          <div class="ctx-separator"></div>
          <button class="ctx-item" onclick={stageMenuSaveProject}>
            Save Project<span class="ctx-shortcut">Ctrl+S</span>
          </button>
          <div class="ctx-separator"></div>
          <button class="ctx-item ctx-danger" onclick={stageMenuDelete}>Delete Preset</button>
        </div>
      {/if}

      <!-- Clip Preview Panel — opened from cell context menu's Edit/Preview.
           Bank tag passed through so writes target the correct deck. -->
      {#if previewPanel}
        <ClipPreviewPanel
          layerIndex={previewPanel.layer}
          columnIndex={previewPanel.column}
          clip={previewPanel.clip}
          bank={previewPanel.bank}
          onClose={() => previewPanel = null}
        />
      {/if}

      <!-- Right Panel: Media Tray (collapsible) -->
      <div class="media-tray-vj" class:collapsed={mediaTrayCollapsed}>
        <button class="tray-collapse-btn" onclick={() => mediaTrayCollapsed = !mediaTrayCollapsed} title={mediaTrayCollapsed ? 'Expand media tray' : 'Collapse media tray'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            {#if mediaTrayCollapsed}
              <polyline points="15 18 9 12 15 6"/>
            {:else}
              <polyline points="9 18 15 12 9 6"/>
            {/if}
          </svg>
        </button>
        {#if !mediaTrayCollapsed}
        <!-- Tab Icons Row (matching mapping mode).  In MAP sub-mode only
             the Maps tab is shown — the panel becomes a preset-only mixer
             so hiding the other source tabs prevents accidentally dragging
             non-preset content into the cells. Reactive auto-select below
             ensures the tab pointer lands on 'maps' when entering MAP. -->
        <div class="vj-tabs">
          <div class="vj-tab-row">
            {#if !$vjClipLauncher.mapMode}
              <button class="vj-tab" class:active={vjMediaTab === 'shaders'} onclick={() => vjMediaTab = 'shaders'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                <span>FX</span>
                {#if shaders.length}<span class="vj-tab-count">{shaders.length}</span>{/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'js'} onclick={() => vjMediaTab = 'js'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
                <span>JS</span>
                {#if threejsItems.length}<span class="vj-tab-count">{threejsItems.length}</span>{/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'library'} onclick={() => vjMediaTab = 'library'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <span>Saved</span>
                {#if savedShaders.length}<span class="vj-tab-count">{savedShaders.length}</span>{/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'videos'} onclick={() => vjMediaTab = 'videos'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Vid</span>
                {#if $mediaLibrary.filter(m => m.type === 'video').length}<span class="vj-tab-count">{$mediaLibrary.filter(m => m.type === 'video').length}</span>{/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'images'} onclick={() => vjMediaTab = 'images'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Img</span>
                {#if $mediaLibrary.filter(m => m.type === 'image').length}<span class="vj-tab-count">{$mediaLibrary.filter(m => m.type === 'image').length}</span>{/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'sources'} onclick={() => vjMediaTab = 'sources'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                <span>Src</span>
                {#if vjLiveSources.filter(s => s.status === 'live').length > 0}
                  <span class="vj-tab-count live">{vjLiveSources.filter(s => s.status === 'live').length}</span>
                {/if}
              </button>
              <button class="vj-tab" class:active={vjMediaTab === 'plugins'} onclick={() => vjMediaTab = 'plugins'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 8 4 12 4 15a8 8 0 1 0 16 0c0-3-2.5-7-8-13Z"/></svg>
                <span>Plug</span>
              </button>
            {/if}
            {#if $vjClipLauncher.mapMode}
              <button class="vj-tab" class:active={vjMediaTab === 'maps'} onclick={() => vjMediaTab = 'maps'} title="Saved mapping presets — drag onto a clip cell. Stack with VJ layer opacity + blend.">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 7 3 17 6 23 3 23 18 17 21 7 18 1 21 1 6"/><line x1="7" y1="3" x2="7" y2="18"/><line x1="17" y1="6" x2="17" y2="21"/></svg>
                <span>Maps</span>
                {#if $compositions.length}<span class="vj-tab-count">{$compositions.length}</span>{/if}
              </button>
            {/if}
          </div>
        </div>

        <!-- AI Generator Buttons -->
        <div class="vj-ai-section">
          <button class="vj-ai-btn" onclick={() => { vjShowAIGenerator = !vjShowAIGenerator; if (vjShowAIGenerator) vjShowVideoGenerator = false; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            {vjShowAIGenerator ? 'Hide AI' : 'AI Generate'}
          </button>
          <button class="vj-ai-btn vj-ai-video-btn" onclick={() => { vjShowVideoGenerator = !vjShowVideoGenerator; if (vjShowVideoGenerator) vjShowAIGenerator = false; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {vjShowVideoGenerator ? 'Hide' : 'AI Video'}
          </button>
        </div>

        <!-- AI Generator Panels -->
        {#if vjShowAIGenerator}
          <div class="vj-ai-container">
            <AIShaderGenerator
              on:generated={handleVJAIGenerated}
              on:close={() => { vjShowAIGenerator = false; }}
            />
          </div>
        {/if}

        {#if vjShowVideoGenerator}
          <div class="vj-ai-container">
            <AIVideoGenerator
              on:generated={handleVJAIVideoGenerated}
              on:close={() => { vjShowVideoGenerator = false; }}
            />
          </div>
        {/if}

        <!-- Loading indicator -->
        {#if shadersLoading && (vjMediaTab === 'shaders' || vjMediaTab === 'js')}
          <div class="loading">Loading shaders...</div>
        {/if}

        <!-- Import bar: file picker for VJ-only media import -->
        {#if vjMediaTab === 'videos' || vjMediaTab === 'images'}
          <div class="vj-import-bar">
            <button class="vj-import-btn" onclick={() => vjMediaFileInput?.click()} title="Import files from disk">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import {vjMediaTab === 'videos' ? 'Videos' : 'Images'}
            </button>
            <input
              type="file"
              bind:this={vjMediaFileInput}
              accept={vjMediaTab === 'videos' ? 'video/*' : 'image/*'}
              multiple
              style="display:none;"
              onchange={vjHandleMediaFilePick}
            />
          </div>
        {/if}

        <!-- Media List -->
        <div
          class="media-list"
          class:vj-media-drag-over={vjMediaDragOver}
          ondragover={vjHandleMediaDragOver}
          ondragleave={vjHandleMediaDragLeave}
          ondrop={vjHandleMediaDrop}
          role="region">
          {#if vjMediaTab === 'sources'}
            <!-- Live Sources Panel for VJ -->
            <div class="vj-sources-panel">
              <div class="vj-sources-btns">
                <button class="vj-src-btn" onclick={() => vjStartWebcam()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  Webcam
                </button>
                <button class="vj-src-btn" onclick={() => vjStartCapture()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                  Capture
                </button>
                <button class="vj-src-btn spout-btn" class:active={vjShowSpoutPicker} onclick={() => { vjShowSpoutPicker = !vjShowSpoutPicker; if (vjShowSpoutPicker) vjScanSpout(); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>
                  </svg>
                  {getTextureShareLabel()}
                </button>
                <button class="vj-src-btn ndi-btn" class:active={vjShowNdiPicker} onclick={() => { vjShowNdiPicker = !vjShowNdiPicker; if (vjShowNdiPicker) { vjShowSpoutPicker = false; void vjStartNdiScan(); } }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="11"/>
                  </svg>
                  NDI®
                </button>
              </div>
              {#if vjShowNdiPicker}
                <div class="vj-spout-picker">
                  {#if vjDetectedNdiSources.length > 0}
                    <div class="vj-spout-list">
                      {#each vjDetectedNdiSources as src (src.name)}
                        <button class="vj-spout-sender" onclick={() => { vjAddNdiSource(src.name); vjShowNdiPicker = false; }} title={src.url}>
                          {src.name}
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <div class="empty-media" style="padding: 12px 14px;">
                      <p>{!vjNdiChecked || vjNdiScanning ? 'Scanning for NDI® sources...' : vjNdiAvailable ? 'No NDI® sources detected' : 'NDI® unavailable'}</p>
                      <p class="hint">{vjNdiStatusHint}</p>
                    </div>
                  {/if}
                  <p class="hint" style="padding: 0 14px 10px;">
                    <a href="https://ndi.video/" target="_blank" rel="noreferrer">NDI®</a>
                    is a registered trademark of Vizrt NDI AB.
                  </p>
                </div>
              {/if}
              {#if vjShowSpoutPicker}
                <div class="vj-spout-picker">
                  {#if vjDetectedSpoutSenders.length > 0}
                    <div class="vj-spout-list">
                      {#each vjDetectedSpoutSenders as sender}
                        <button class="vj-spout-sender" onclick={() => { vjAddSpoutInput(sender); vjShowSpoutPicker = false; }}>
                          {sender}
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <div class="empty-media" style="padding: 12px 14px;">
                      <p>{vjTextureShareAvailable ? `No ${getTextureShareLabel()} senders detected` : `${getTextureShareLabel()} native bridge unavailable`}</p>
                      <p class="hint">{vjTextureShareHint}</p>
                    </div>
                  {/if}
                  <div class="vj-spout-manual">
                    <input type="text" class="vj-spout-input" placeholder="Sender name..." bind:value={vjSpoutInput} onkeydown={(e) => { if (e.key === 'Enter' && vjSpoutInput.trim()) { vjAddSpoutInput(vjSpoutInput.trim()); vjSpoutInput = ''; vjShowSpoutPicker = false; } }} />
                    <button class="vj-spout-connect" disabled={!vjSpoutInput.trim()} onclick={() => { if (vjSpoutInput.trim()) { vjAddSpoutInput(vjSpoutInput.trim()); vjSpoutInput = ''; vjShowSpoutPicker = false; } }}>
                      Go
                    </button>
                  </div>
                </div>
              {/if}
              {#if vjLiveSources.length === 0}
                <div class="empty-media">
                  <p>No live sources active</p>
                  <p class="hint">Add webcam, capture, {getTextureShareLabel()}, or NDI® input above</p>
                </div>
              {:else}
                <div class="vj-live-source-list">
                  {#each vjLiveSources as src (src.id)}
                    <div
                      class="vj-source-item"
                      class:source-live={src.status === 'live'}
                      class:source-pending={src.status !== 'live'}
                      draggable={src.status === 'live' ? 'true' : 'false'}
                      ondragstart={(e) => handleLiveSourceDragStart(e, src)}
                      ondragend={handleDragEnd}
                      title="Drag onto a clip slot or click +"
                    >
                      <div class="source-thumb">
                        <span class="source-type-icon">{vjLiveSourceIconLabel(src)}</span>
                        {#if src.status === 'live'}
                          <span class="thumb-live-dot"></span>
                        {/if}
                      </div>
                      <div class="source-info">
                        <span class="source-name">{src.name}</span>
                        <span class="source-status">{src.status}</span>
                      </div>
                      <div class="source-actions">
                        <button
                          class="vj-src-add"
                          disabled={src.status !== 'live'}
                          onclick={(e) => { e.stopPropagation(); addLiveSourceToDeck(src); }}
                          title="Add to deck"
                        >+</button>
                        <button
                          class="vj-src-stop"
                          onclick={(e) => { e.stopPropagation(); vjStopSource(src.id); }}
                          title="Stop"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else if vjMediaTab === 'plugins'}
            <!-- Plugins Panel (FluidGen, Particles3D) - Integrated WebGL effects -->
            <div class="vj-plugins-panel">
              {#each vjPluginCards as plugin (plugin.id)}
                <div
                  class="vj-plugin-card running"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: plugin.clipType, id: plugin.id, effectType: plugin.effectType, pluginName: plugin.name })}
                  ondragend={handleDragEnd}
                  title="Drag {plugin.name} onto a clip slot"
                >
                  <div class="vj-plugin-icon">
                    {#if plugin.inlineIcon === 'gpu'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="9"/>
                        <path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z"/>
                      </svg>
                    {:else if plugin.inlineIcon === 'text'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M4 5h16M12 5v14M8 19h8"/>
                      </svg>
                    {:else if plugin.inlineIcon === 'splat'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="1.5"/>
                        <circle cx="8" cy="8" r="1"/>
                        <circle cx="16" cy="8" r="1"/>
                        <circle cx="6" cy="14" r="1"/>
                        <circle cx="18" cy="14" r="1"/>
                        <circle cx="10" cy="18" r="1"/>
                        <circle cx="15" cy="17" r="1"/>
                        <circle cx="4" cy="10" r="0.8"/>
                        <circle cx="20" cy="10" r="0.8"/>
                        <circle cx="12" cy="6" r="0.8"/>
                        <circle cx="9" cy="12" r="0.6"/>
                        <circle cx="15" cy="12" r="0.6"/>
                      </svg>
                    {:else if plugin.inlineIcon === 'model3d'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5Z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                      </svg>
                    {:else if plugin.inlineIcon === 'synthvision'}
                      <!-- Atom glyph the Performer button used to carry. -->
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                        <ellipse cx="12" cy="12" rx="10" ry="4"/>
                        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/>
                        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>
                      </svg>
                    {:else}
                      <PluginIcon pluginId={plugin.id} effectType={plugin.effectType ?? null} size={24} />
                    {/if}
                  </div>
                  <div class="vj-plugin-info">
                    <span class="vj-plugin-name">{plugin.name}</span>
                    <span class="vj-plugin-desc">{plugin.description}</span>
                    <span class="vj-plugin-status live">{plugin.tier.toUpperCase()}</span>
                  </div>
                </div>
              {/each}
              <div class="vj-plugin-hint">
                <p>Drag effect onto a clip slot to use it</p>
                <p>Same plugin set as the editor's Plugins tab</p>
              </div>
            </div>
          {:else if vjMediaTab === 'maps'}
            <!-- Maps tab — saved mapping presets, drag onto a clip cell to
                 install a "load preset on fire" trigger. Firing the cell
                 calls project.loadComposition() (mapping swap), not a
                 normal content-feed-into-layer trigger. -->
            {#if $compositions.length === 0}
              <div class="empty-media">
                <p>No saved mapping presets</p>
                <p class="hint">Save a mapping preset (Presets tray ▲) then come back — drag it onto a clip cell to launch it from the VJ mixer.</p>
              </div>
            {:else}
              {#each $compositions as comp (comp.id)}
                <div
                  class="media-item"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: 'preset', id: comp.id })}
                  ondragend={handleDragEnd}
                  role="button"
                  tabindex="0"
                  title="Drag onto a clip cell — firing it loads this mapping preset"
                >
                  <div class="item-thumb">
                    {#if comp.thumbnail}
                      <img src={comp.thumbnail} alt={comp.name} />
                    {:else}
                      <div class="thumb-placeholder"><span>MAP</span></div>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">{comp.name}</span>
                    <span class="item-type">preset · {comp.layers.length} layer{comp.layers.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
              {/each}
            {/if}
          {:else if vjMediaTab === 'library'}
            <!-- Saved shaders/videos -->
            {#if savedShaders.length === 0 && savedVideos.length === 0}
              <div class="empty-media">
                <p>No saved items</p>
                <p class="hint">Generate shaders or videos with AI to save them here</p>
              </div>
            {:else}
              {#each savedShaders as saved (saved.id)}
                <div
                  class="media-item"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: 'shader', id: saved.id })}
                  ondragend={handleDragEnd}
                  role="button"
                  tabindex="0"
                >
                  <div class="item-thumb">
                    {#if saved.thumbnail}
                      <img src={saved.thumbnail} alt={saved.name} />
                    {:else}
                      <div class="thumb-placeholder shader"><span>ISF</span></div>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">{saved.name}</span>
                    <span class="item-type">saved shader</span>
                  </div>
                </div>
              {/each}
              {#each savedVideos as vid (vid.id)}
                <div class="media-item" draggable="true" ondragstart={(e) => handleDragStart(e, { type: 'video', id: vid.id })} ondragend={handleDragEnd} role="button" tabindex="0">
                  <div class="item-thumb">
                    {#if vid.thumbnail}
                      <img src={vid.thumbnail} alt={vid.name} />
                    {:else}
                      <div class="thumb-placeholder video"><span>VID</span></div>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">{vid.name}</span>
                    <span class="item-type">saved video</span>
                  </div>
                </div>
              {/each}
            {/if}
          {:else if vjFilteredMedia.length === 0}
            <div class="empty-media">
              <p>No media available</p>
              <p class="hint">Drag & drop files or use AI Generate</p>
            </div>
          {:else}
            {#each vjFilteredMedia as item (item.id)}
              <div
                class="media-item"
                class:dragging={draggedClip?.id === item.id}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, { type: item.itemType, id: item.id })}
                ondragend={handleDragEnd}
                role="button"
                tabindex="0"
              >
                <div class="item-thumb">
                  {#if item.thumbnail}
                    <img src={item.thumbnail} alt={item.name} />
                  {:else}
                    <div class="thumb-placeholder {item.itemType}">
                      <span>{item.itemType === 'shader' ? 'ISF' : item.itemType === 'video' ? 'VID' : item.itemType === 'threejs' ? '3JS' : 'IMG'}</span>
                    </div>
                  {/if}
                </div>
                <div class="item-info">
                  <span class="item-name">{item.name}</span>
                  <span class="item-type">{item.itemType}</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
        {/if}
      </div>
      </div> <!-- End vj-bottom -->

      <!-- Deck dock — the performance strip that belongs with the grid rather
           than the app chrome. Audio (analyzer, input, launch quantize) on the
           left; deck tools (sequencer, A/B, Performer) on the right. These
           lived in the header until the audio cluster's width started pushing
           the header's right-hand controls off the edge. Popovers raised from
           here open UPWARD — there is no room below the bar. -->
      <div class="vj-dock">
        <div class="vj-dock-group">
          <AudioMeterPanel openUp={true} />

          <!-- Same picker component mapping and Performer use; state flows
               through audioStore, so toggling here flips every mode. -->
          <AudioInputPicker showWaveform={false} openUp={true} />

          <!-- Launch quantization. OFF = instant trigger (default); 1/4..4bar
               align launches to detected beats (or the virtual clock at the
               current BPM when audio is off). -->
          <div class="dock-quant" title="Launch quantize — clips fire on the next beat boundary instead of instantly">
            <span class="dock-quant-label">QUANT</span>
            <select
              class="dock-quant-select"
              value={$vjClipLauncher.quantization}
              onchange={(e) => vjClipLauncher.setQuantization((e.target as HTMLSelectElement).value as any)}
              data-midi-path="vj:quantize"
              data-midi-label="Launch Quantize"
              data-midi-discrete="true"
            >
              <option value="off">OFF</option>
              <option value="1/4">1/4</option>
              <option value="1/2">1/2</option>
              <option value="1bar">1 BAR</option>
              <option value="2bar">2 BAR</option>
              <option value="4bar">4 BAR</option>
            </select>
            {#if $vjClipLauncher.pendingTriggers.length > 0}
              <span class="dock-quant-pending" title="{$vjClipLauncher.pendingTriggers.length} clip{$vjClipLauncher.pendingTriggers.length === 1 ? '' : 's'} queued">
                {$vjClipLauncher.pendingTriggers.length} ·
              </span>
            {/if}
          </div>
        </div>

        <div class="vj-dock-group vj-dock-tools">
          <button
            class="vj-seq-toggle-btn dock-labelled-btn"
            class:active={$vjLayerSequencer.isOpen}
            onclick={() => vjLayerSequencer.toggleOpen()}
            title="Layer Sequencer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="4" height="14" rx="1.2" fill="#ff7a66"/>
              <rect x="10" y="8" width="4" height="11" rx="1.2" fill="#ffd166"/>
              <rect x="17" y="3" width="4" height="16" rx="1.2" fill="#46d18a"/>
              <path d="M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Sequencer
          </button>

          {#if $vjClipLauncher.isLive}
            <button
              class="ab-toggle-btn dock-labelled-btn"
              class:active={$vjClipLauncher.crossfaderEnabled}
              onclick={() => vjClipLauncher.setCrossfaderEnabled(!$vjClipLauncher.crossfaderEnabled)}
              title="Split the deck into two independent banks with a transition fader between them"
              data-midi-path="vj:crossfader:enabled"
              data-midi-label="Crossfader Enabled"
              data-midi-mode="toggle"
            >
              Split Deck A/B
            </button>
          {/if}

        </div>
      </div>
    </div>

    <VJLayerSequencer />
</div>
{/if}

{#if vjScreenPickerOpen}
  <div
    class="capture-picker-backdrop"
    onclick={closeVjScreenPicker}
    role="dialog"
    aria-modal="true"
    aria-label="Pick a screen or window to capture"
  >
    <div class="capture-picker-modal" onclick={(e) => e.stopPropagation()} role="document">
      <div class="cpm-header">
        <div class="cpm-title">Capture a screen or window</div>
        <button class="cpm-close" onclick={closeVjScreenPicker} title="Close">x</button>
      </div>

      {#if vjScreenPickerLoading}
        <div class="cpm-loading">Loading sources...</div>
      {:else if vjScreenPickerSources.length === 0}
        <div class="cpm-empty">
          No capturable sources found. Make sure screen recording permission is enabled for Ghost Arcade.
        </div>
      {:else}
        {@const screens = vjScreenPickerSources.filter(s => s.kind === 'screen')}
        {@const windows = vjScreenPickerSources.filter(s => s.kind === 'window')}

        <div class="cpm-body">
          {#if screens.length > 0}
            <div class="cpm-section-title">Screens</div>
            <div class="cpm-grid">
              {#each screens as src (src.id)}
                <button class="cpm-card" onclick={() => vjPickScreenSource(src)} title={src.name}>
                  {#if src.thumbnailDataUrl}
                    <img class="cpm-thumb" src={src.thumbnailDataUrl} alt={src.name} />
                  {:else}
                    <div class="cpm-thumb cpm-thumb-empty">No preview</div>
                  {/if}
                  <div class="cpm-name">{src.name}</div>
                </button>
              {/each}
            </div>
          {/if}

          {#if windows.length > 0}
            <div class="cpm-section-title">Application windows</div>
            <div class="cpm-grid">
              {#each windows as src (src.id)}
                <button class="cpm-card" onclick={() => vjPickScreenSource(src)} title={src.name}>
                  {#if src.thumbnailDataUrl}
                    <img class="cpm-thumb" src={src.thumbnailDataUrl} alt={src.name} />
                  {:else}
                    <div class="cpm-thumb cpm-thumb-empty">No preview</div>
                  {/if}
                  <div class="cpm-name-row">
                    {#if src.appIconDataUrl}
                      <img class="cpm-app-icon" src={src.appIconDataUrl} alt="" />
                    {/if}
                    <div class="cpm-name">{src.name}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Performer - persists outside VJ panel lifecycle to avoid destroy/recreate on VJ close -->
{#if performerStarted}
  <div class="performer-overlay" class:hidden={!showPerformer || !$vjClipLauncher.isOpen} style="top: {performerTop}px">
    <div
      class="performer-resize-handle"
      onpointerdown={onPerformerResizeStart}
      onpointermove={onPerformerResizeMove}
      onpointerup={onPerformerResizeEnd}
      onpointercancel={onPerformerResizeEnd}
    >
      <div class="resize-grip"></div>
    </div>
    <SynthVision
      onClose={() => showPerformer = false}
      visible={showPerformer && $vjClipLauncher.isOpen}
      hostLayer={$synthVisionStore.assignedLayer ?? 0}
    />
  </div>
{/if}

<!-- Effect Picker Modal (full catalog, multi-select, 3-col grid) -->
<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={handlePickerAdd}
  onClose={() => showEffectPicker = false}
/>

<style>
  /* VJ Overlay */
  .vj-overlay {
    position: fixed;
    inset: 0;
    background: #0a0a0a;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    transition: bottom 0.2s ease-out;
    --vj-header-h: 58px;
    --vj-header-pad-x: 12px;
    --vj-header-gap: 8px;
    --vj-half-gap: 4px;
    --vj-meter-gap: 6px;
    --vj-right-gap: 4px;
    --vj-control-h: 30px;
    --vj-icon-btn: 30px;
    --vj-header-font: 13px;
    --vj-label-font: 11px;
    --vj-stage-pad-x: 13px;
    --vj-file-pad-x: 10px;
    --vj-master-slider-w: 58px;
    --vj-logo-h: 26px;
    --vj-macro-slot: 46px;
    --vj-macro-knob: 34px;
    --vj-macro-bank-w: 382px;
    --vj-macro-gap: 0px;
    --vj-macro-name-font: 9px;
    --vj-snap-font: 12px;
    --vj-snap-pad-x: 9px;
    --vj-aip-chevron-w: 14px;
    --vj-amp-bar-w: 5px;
    --vj-amp-bar-gap: 3px;
  }
  .vj-overlay.kf-tray-open {
    bottom: 300px;
  }

  /* Header Stage/Mix toggle */
  /* Centred in the gap between the left controls and the macro bank: the
     wrapper takes the leftover lead-column width, the pill centres in it. */
  .header-stage-slot {
    display: flex;
    flex: 1 1 auto;
    justify-content: center;
    min-width: 0;
  }
  .header-stage {
    display: flex;
    flex: 0 0 auto;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #444;
    z-index: 2;
  }

  .stage-mix-btn {
    height: var(--vj-control-h);
    padding: 0 var(--vj-stage-pad-x);
    background: #1a1a1a;
    border: none;
    color: var(--text-muted, #888);
    font-size: var(--vj-header-font);
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .stage-mix-btn:first-child {
    border-right: 1px solid #444;
  }

  .stage-mix-btn:hover {
    color: #fff;
    background: #2a2a2a;
  }

  .stage-mix-btn.active {
    background: #f90;
    color: #000;
  }

  /* ===== A/B Crossfader toggle (right cluster) =====
     Slot-in icon-button — same height (32px) and visual weight as the
     other right-cluster controls so it reads as one tidy grid. The
     gradient/glow stays for the active state so it remains the most
     distinctive toggle in the row. */
  .ab-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--vj-control-h);
    padding: 0 calc(var(--vj-stage-pad-x) - 2px);
    border-radius: var(--ga-r-hard, 2px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    background: transparent;
    color: var(--ga-ink-1, #b8bdc6);
    font-size: var(--vj-header-font);
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
    flex: 0 0 auto;
  }
  .ab-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.30);
    color: var(--ga-ink-0, #eef0f4);
  }
  .ab-toggle-btn.active {
    background: linear-gradient(135deg, #FF8577, #7EC8E3);
    color: #0a0a0a;
    border-color: transparent;
    box-shadow: 0 0 12px rgba(255, 133, 119, 0.45);
  }
  .ab-toggle-glyph {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .ab-toggle-label {
    text-transform: uppercase;
  }
  .vj-seq-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--vj-icon-btn);
    height: var(--vj-control-h);
    padding: 0;
    border-radius: var(--ga-r-hard, 2px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    background: transparent;
    color: var(--ga-ink-1, #b8bdc6);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
    flex: 0 0 auto;
  }
  .vj-seq-toggle-btn:hover {
    background: var(--ga-coral-soft, rgba(255, 111, 94, 0.11));
    border-color: var(--ga-coral-line, rgba(255, 111, 94, 0.4));
    color: var(--ga-ink-0, #eef0f4);
  }
  .vj-seq-toggle-btn.active {
    background: var(--ga-coral-soft, rgba(255, 111, 94, 0.11));
    border-color: var(--ga-coral, #ff6f5e);
    box-shadow: 0 0 12px var(--ga-coral-glow, rgba(255,111,94,.35));
  }

  /* ===== Dual decks (crossfader on) ===== */
  /* When the crossfader is enabled the grid splits into two complete decks
     with a vertical fader strip between. Each deck is a full clip launcher
     UI bound to its own bank state. */
  .dual-decks {
    display: flex;
    align-items: stretch;
    gap: 8px;
    flex: 1;
    min-height: 0;
  }
  .deck-wrapper {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    background: #0c0c10;
    padding: 8px;
    transition: border-color 0.18s, box-shadow 0.18s;
  }
  .deck-wrapper.deck-a { border-top: 2px solid rgba(126, 200, 227, 0.55); }
  .deck-wrapper.deck-b { border-top: 2px solid rgba(255, 133, 119, 0.55); }
  .deck-wrapper.focused {
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 12px 32px rgba(0, 0, 0, 0.45);
    border-color: #555;
  }
  .deck-label {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--text-muted, #888);
    margin-bottom: 6px;
    padding: 2px 6px;
    align-self: flex-start;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
  }
  .deck-wrapper.deck-a .deck-label { color: #7EC8E3; }
  .deck-wrapper.deck-b .deck-label { color: #FF8577; }

  /* Vertical crossfader strip between the two decks */
  .crossfader-strip {
    flex: 0 0 88px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    background: linear-gradient(180deg, #0a0a0e, #0e0e14);
    border: 1px solid #2a2a2a;
    border-radius: 8px;
  }
  .xfade-mod-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    margin-bottom: 1px;
  }
  .xfade-mod-label {
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: rgba(148, 163, 184, 0.72);
    line-height: 1;
  }
  .crossfader-strip .mod-source-chip.xfade-mod-chip {
    width: 58px;
    max-width: 58px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    font-size: 10px;
    line-height: 1;
    text-align: center;
  }
  .crossfader-strip .mod-source-chip.xfade-mod-chip.active {
    border-color: rgba(126, 200, 227, 0.85);
    color: #bff2ff;
    background: rgba(126, 200, 227, 0.10);
  }
  .crossfader-strip .mod-source-chip.xfade-mod-chip.auto {
    border-color: rgba(34, 211, 238, 0.9);
    color: #9af7ff;
    background: rgba(34, 211, 238, 0.10);
  }
  .cut-btn {
    width: 44px;
    height: 22px;
    border: 1px solid #444;
    background: #181820;
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .cut-btn:hover { background: #232330; color: #fff; }
  .cut-btn.cut-a.active { background: #7EC8E3; color: #000; border-color: #7EC8E3; }
  .cut-btn.cut-b.active { background: #FF8577; color: #000; border-color: #FF8577; }

  .xfade-vertical-track {
    flex: 1;
    min-height: 140px;
    display: flex;
    align-items: stretch;
    justify-content: center;
    width: 44px;
    position: relative;
  }
  /* Vertical range input. Two things were breaking it:
       1. The global skin (App.svelte + studio-skin.css) restyles every
          range input into a HORIZONTAL custom slider unless the element is
          on the crossfader exemption list — this class is now exempt there.
       2. The old `appearance: slider-vertical` keyword is removed in current
          Chromium (Electron 33 / Chromium 130) and collapses the control to
          an unusable horizontal sliver. We use the standards-track
          `writing-mode: vertical-lr` + `direction: rtl` and a custom
          `::-webkit-slider-thumb` (same recipe as SynthVision's .sv-xf-range).
     value=0 (full Deck A) sits at the TOP, value=1 (full Deck B) at the
     BOTTOM — matching the Cut A / Cut B buttons above and below the fader. */
  .xfade-vertical-input {
    position: absolute;
    inset: 0;
    z-index: 2;
    writing-mode: vertical-lr;
    direction: rtl;
    -webkit-appearance: none;
    appearance: none;
    width: 44px;
    height: 100%;
    min-height: 140px;
    margin: 0;
    padding: 0;
    background: transparent;
    opacity: 0;
    accent-color: var(--accent-primary, #BB86FC);
    cursor: pointer;
  }
  .xfade-vertical-rail {
    position: absolute;
    top: 9px;
    bottom: 9px;
    left: 50%;
    width: 6px;
    transform: translateX(-50%);
    background: linear-gradient(to bottom, #7EC8E3, #9f75ad 50%, #FF8577);
    border-radius: 999px;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      0 0 12px rgba(126, 200, 227, 0.18),
      0 0 18px rgba(255, 133, 119, 0.12);
    pointer-events: none;
  }
  .xfade-vertical-knob {
    position: absolute;
    left: 50%;
    z-index: 1;
    width: 34px;
    height: 18px;
    transform: translate(-50%, -50%);
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.2), transparent 24%, transparent 76%, rgba(0, 0, 0, 0.22)),
      linear-gradient(180deg, #f7f8fb 0%, #d8dde8 48%, #8f98ab 52%, #f4f6fb 100%);
    border-radius: 5px;
    border: 1px solid rgba(4, 6, 12, 0.9);
    box-shadow:
      0 3px 8px rgba(0, 0, 0, 0.55),
      0 0 12px rgba(255, 255, 255, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.85),
      inset 0 -1px 1px rgba(0, 0, 0, 0.28);
    pointer-events: none;
  }
  .xfade-vertical-input:active ~ .xfade-vertical-knob {
    box-shadow:
      0 5px 12px rgba(0, 0, 0, 0.65),
      0 0 16px rgba(255, 255, 255, 0.32),
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      inset 0 -1px 1px rgba(0, 0, 0, 0.32);
  }
  .xfade-vertical-input:focus-visible ~ .xfade-vertical-knob {
    outline: 2px solid rgba(126, 200, 227, 0.8);
    outline-offset: 3px;
  }
  .xfade-vertical-input::-webkit-slider-runnable-track {
    width: 6px;
    background: linear-gradient(to bottom, #7EC8E3, #9f75ad 50%, #FF8577);
    border-radius: 3px;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      0 0 10px rgba(126, 200, 227, 0.18);
  }
  .xfade-vertical-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 34px;
    height: 18px;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.2), transparent 24%, transparent 76%, rgba(0, 0, 0, 0.22)),
      linear-gradient(180deg, #f7f8fb 0%, #d8dde8 48%, #8f98ab 52%, #f4f6fb 100%);
    border-radius: 5px;
    border: 1px solid rgba(4, 6, 12, 0.9);
    box-shadow:
      0 3px 8px rgba(0, 0, 0, 0.55),
      0 0 12px rgba(255, 255, 255, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.85),
      inset 0 -1px 1px rgba(0, 0, 0, 0.28);
    margin-left: -14px;
    cursor: grab;
  }
  .xfade-vertical-input::-webkit-slider-thumb:active { cursor: grabbing; }
  .xfade-vertical-input::-moz-range-track {
    width: 6px;
    background: linear-gradient(to bottom, #7EC8E3, #9f75ad 50%, #FF8577);
    border-radius: 3px;
    border: 0;
  }
  .xfade-vertical-input::-moz-range-thumb {
    width: 34px;
    height: 18px;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.2), transparent 24%, transparent 76%, rgba(0, 0, 0, 0.22)),
      linear-gradient(180deg, #f7f8fb 0%, #d8dde8 48%, #8f98ab 52%, #f4f6fb 100%);
    border-radius: 5px;
    border: 1px solid rgba(4, 6, 12, 0.9);
    box-shadow:
      0 3px 8px rgba(0, 0, 0, 0.55),
      0 0 12px rgba(255, 255, 255, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.85),
      inset 0 -1px 1px rgba(0, 0, 0, 0.28);
    cursor: grab;
  }

  .xfade-readout {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: var(--accent-primary, #BB86FC);
    letter-spacing: 0.05em;
    padding: 2px 6px;
    background: rgba(187, 134, 252, 0.08);
    border-radius: 3px;
  }

  .xfade-time-control {
    width: 76px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: center;
    color: rgba(148, 163, 184, 0.72);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.12em;
    line-height: 1;
  }

  .xfade-select {
    width: 76px;
    padding: 4px 6px;
    background: #181820;
    border: 1px solid #333;
    border-radius: 4px;
    color: var(--text-primary, #ddd);
    font-size: 11px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    cursor: pointer;
    text-align: center;
  }
  .xfade-select:hover { border-color: #555; }
  .xfade-select.xfade-curve { color: var(--text-secondary, #aaa); }
  .xfade-select.xfade-time {
    color: #bff2ff;
  }

  /* When dual decks are active, individual deck-wrappers handle their own
     horizontal + vertical scroll so the vertical fader between them stays
     put. Column headers and layer rows scroll together because they're
     siblings inside the same scrollable container — they stay aligned
     at every scroll offset. */
  .deck-wrapper {
    overflow: auto;
    position: relative;       /* anchor for the .scroll-hint arrow below */
  }

  /* Lock cell + column-trigger widths inside dual-deck mode so the two
     stay perfectly aligned and ~5 columns are visible per deck before
     scroll. The natural single-deck mode keeps its flex:1 stretch
     behavior because these selectors are scoped under .deck-wrapper. */
  .deck-wrapper .column-trigger {
    flex: 0 0 110px;
    width: 110px;
  }
  .deck-wrapper .clip-cell {
    flex: 0 0 110px;
    width: 110px;
    min-width: 110px;
    /* aspect-ratio: 16/9 stays from the base rule */
  }
  /* Headers and rows must size to the full width of all their cells so the
     wrapper detects the horizontal overflow correctly. */
  .deck-wrapper .column-headers {
    width: max-content;
    min-width: 100%;
  }
  .deck-wrapper .layer-row {
    width: max-content;
    min-width: 100%;
  }

  /* Color-coded horizontal scrollbars per deck — cyan for A, coral for B.
     Replaces the old pulsing ▶ arrow indicator: when the scrollbar is
     visible at all the user knows there's more content, and the accent
     color makes it obvious which deck they're scrolling. WebKit (Chromium /
     Electron) supports custom scrollbar styling via -webkit-scrollbar
     pseudo-elements. */
  .deck-wrapper::-webkit-scrollbar {
    width: 8px;
    height: 10px;            /* horizontal — the part users actually see */
  }
  .deck-wrapper::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 5px;
  }
  .deck-wrapper.deck-a::-webkit-scrollbar-thumb {
    background: rgba(126, 200, 227, 0.55);
    border-radius: 5px;
    border: 2px solid #0c0c10;
  }
  .deck-wrapper.deck-a::-webkit-scrollbar-thumb:hover {
    background: rgba(126, 200, 227, 0.85);
  }
  .deck-wrapper.deck-b::-webkit-scrollbar-thumb {
    background: rgba(255, 133, 119, 0.55);
    border-radius: 5px;
    border: 2px solid #0c0c10;
  }
  .deck-wrapper.deck-b::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 133, 119, 0.85);
  }

  /* Header */
  /* Frameless caption: the VJ header acts as the OS title bar on Windows —
     drag-to-move and dblclick-to-maximize are wired in JS above. */
  .vj-header.frameless-caption {
    cursor: default;
    user-select: none;
  }

  .vj-win-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 6px;
  }
  .vj-win-ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #b8bcc4);
    cursor: pointer;
    border-radius: 4px;
  }
  .vj-win-ctl:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .vj-win-ctl.vj-win-close:hover {
    background: #e81123;
    color: #fff;
  }

  /* Three columns: lead controls | macro bank | right cluster. The two side
     columns are equal fractions, so the macro bank lands dead centre no
     matter how wide either side's contents are. */
  .vj-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    position: relative;
    gap: var(--vj-header-gap);
    min-height: var(--vj-header-h);
    box-sizing: border-box;
    padding: 6px var(--vj-header-pad-x);
    background: #141414;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    overflow: visible;
    font-size: var(--vj-header-font);
    z-index: 20;
  }

  .header-lead {
    display: flex;
    align-items: center;
    gap: var(--vj-header-gap);
    min-width: 0;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--vj-header-gap);
    flex: 0 0 auto;
    min-width: 0;
  }
  /* Right cluster is a tight icon grid — REC, A/B, Performer, 3D Stage,
     Settings, Back-arrow, Back text. 4px gap matches the mapping-mode
     toolbar-right so the two modes feel like one product. */
  .header-right {
    display: flex;
    align-items: center;
    gap: var(--vj-right-gap);
    margin-left: 0;
    z-index: 3;
    /* Right column, pinned to the end. Never wraps — Exit VJ has to stay
       reachable. */
    justify-self: end;
    flex-wrap: nowrap;
    background: transparent;
    padding-left: 0;
  }

  /* Macro knob row — sits between the crossfader toggle and the audio
     meter. Always visible; users can resize / reorder by editing the
     header layout. The bar self-sizes to its content. */
  .header-macros {
    display: flex;
    align-items: center;
    justify-content: center;
    justify-self: center;
    width: var(--vj-macro-bank-w);
    min-width: 0;
    max-width: var(--vj-macro-bank-w);
    overflow: visible;
    padding: 0;
    margin: 0;
    z-index: 2;
  }

  /* Audio meter slot in the header — sits between the MIX/STAGE/AB cluster
     and the right-side icons. Self-collapses when audio is off. */
  .header-meter {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
    gap: var(--vj-meter-gap);
  }

  .header-meter :global(.amp-strip) {
    gap: var(--vj-meter-gap);
    padding: 0;
  }
  .header-meter :global(.amp-fft-btn) {
    height: var(--vj-control-h);
    padding: 0 calc(var(--vj-file-pad-x) - 2px);
    gap: var(--vj-meter-gap);
  }
  /* Band strip under the scope — the responsive tiers below narrow it on
     smaller windows the same way the old 8-bar meter was tuned. */
  .header-meter :global(.amp-bandstrip) {
    gap: var(--vj-amp-bar-gap);
  }
  .header-meter :global(.aip-btn) {
    width: calc(var(--vj-icon-btn) + 2px);
    height: var(--vj-control-h);
  }
  .header-meter :global(.aip-mic-chevron) {
    width: var(--vj-aip-chevron-w);
  }

  /* Quantize selector — small inline label + native select. Pulses when
     there are pending triggers to draw the eye to the queue. */
  .header-quant {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 calc(var(--vj-file-pad-x) - 4px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    height: var(--vj-control-h);
  }
  .header-quant-label {
    font-size: var(--vj-label-font);
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--text-muted, #888);
  }
  .header-quant-select {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-primary, #ddd);
    font-size: calc(var(--vj-header-font) - 1px);
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .header-quant-select:hover {
    border-color: rgba(255, 255, 255, 0.3);
  }
  .header-quant-pending {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: calc(var(--vj-header-font) - 1px);
    font-weight: 700;
    color: var(--accent-primary, #BB86FC);
    animation: quantPendingPulse 0.8s ease-in-out infinite;
  }
  @keyframes quantPendingPulse {
    0%, 100% { opacity: 0.6; }
    50%      { opacity: 1; }
  }
  /* Audio input picker now lives inside .header-meter (right of the
     analyzer), so no positioning override is needed in the right
     cluster anymore. */

  .vj-logo {
    height: var(--vj-logo-h);
    width: auto;
    margin-right: var(--vj-half-gap);
    border-radius: 6px;
  }

  .vj-file-menu-container { position: relative; margin-right: var(--vj-half-gap); }
  .vj-file-menu-btn {
    display: flex; align-items: center; gap: 4px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: var(--text-primary, #ddd); font-size: var(--vj-header-font); height: var(--vj-control-h); padding: 0 var(--vj-file-pad-x); border-radius: 4px; cursor: pointer;
  }
  .vj-file-menu-btn:hover, .vj-file-menu-btn.active { background: rgba(255,255,255,0.14); color: #fff; }
  .vj-file-menu-dropdown {
    position: absolute; top: 100%; left: 0; margin-top: 4px;
    background: var(--bg-tertiary, #1a1a1e); border: 1px solid #333; border-radius: 6px;
    min-width: 220px; padding: 4px 0; z-index: 10000;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .vj-menu-item {
    display: flex; justify-content: space-between; align-items: center;
    width: 100%; background: none; border: none; color: var(--text-primary, #ddd);
    font-size: 13px; padding: 7px 14px; cursor: pointer; text-align: left;
  }
  .vj-menu-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .vj-menu-sc { color: #666; font-size: 11px; margin-left: 16px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .vj-menu-sep { height: 1px; background: #333; margin: 4px 0; }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Master opacity in the desktop top bar — kept as compact as
     possible so the header fits on a 13" laptop alongside the menu,
     stage toggles, A/B crossfader toggle, and macro bank. Was eating
     ~180px (label + 120px slider + 40px value); now ~110px total. */
  .master-control {
    display: flex;
    align-items: center;
    gap: var(--vj-meter-gap);
    padding-left: var(--vj-file-pad-x);
    border-left: 1px solid #333;
  }

  .master-label {
    font-size: var(--vj-label-font);
    font-weight: 800;
    color: #999;
    width: 10px;
    text-align: center;
  }

  .master-slider {
    width: var(--vj-master-slider-w);
    -webkit-appearance: none;
    appearance: none;
    height: 5px;
    background: #000000;
    border-radius: 3px;
    cursor: pointer;
  }
  .master-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    background: var(--accent-primary, #BB86FC);
    border-radius: 50%;
    cursor: pointer;
  }

  .master-value {
    font-size: calc(var(--vj-header-font) - 1px);
    color: var(--text-muted, #888);
    min-width: 32px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* Compact icon-only kill-output button. Same visual treatment as the
     mapping-mode .blackout-btn so users get the same shape/color/hover
     behavior across modes. Sized to match the rec-btn / settings icon
     so the header reads as a clean row of equal-height controls. */
  .kill-output-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--vj-icon-btn);
    height: var(--vj-control-h);
    padding: 0;
    background: rgba(255, 51, 51, 0.12);
    border: 1px solid rgba(255, 51, 51, 0.4);
    border-radius: 4px;
    color: #ff5555;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
  }
  .kill-output-btn:hover {
    background: rgba(255, 51, 51, 0.25);
    border-color: #ff3333;
    color: #fff;
    box-shadow: 0 0 8px rgba(255, 51, 51, 0.4);
  }
  .kill-output-btn:active {
    transform: scale(0.94);
  }

  /* VJ Recording — matches the mapping-mode rec-btn (transparent box,
     red outline, fixed 32px height) so the same control reads the same
     in both modes. */
  .vj-rec-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--vj-control-h);
    padding: 0 var(--vj-file-pad-x);
    background: transparent;
    border: 1px solid rgba(255, 68, 56, 0.4);
    border-radius: var(--ga-r-hard, 2px);
    color: var(--ga-rec, #ff4438);
    font-size: var(--vj-header-font);
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .vj-rec-btn:hover {
    background: rgba(255, 68, 56, 0.12);
    border-color: rgba(255, 68, 56, 0.6);
    color: var(--ga-rec, #ff3b30);
  }

  .vj-stop-rec-btn {
    background: #ff4444;
    border: none;
    color: #fff;
    height: var(--vj-control-h);
    padding: 0 var(--vj-file-pad-x);
    border-radius: 4px;
    font-size: var(--vj-header-font);
    font-weight: 600;
    cursor: pointer;
  }

  .vj-stop-rec-btn:hover {
    background: #ff6666;
  }

  .vj-recording-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vj-rec-dot {
    width: 8px;
    height: 8px;
    background: #ff4444;
    border-radius: 50%;
    animation: vj-rec-blink 1s infinite;
  }

  @keyframes vj-rec-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .vj-rec-time {
    font-size: var(--vj-header-font);
    font-weight: 600;
    color: #ff4444;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  /* Compact square icon button — same footprint as mapping-mode's
     settings/3D buttons (32×32). No padding around the SVG so the
     icons crowd into a tidy grid. */
  /* Labelled variant — matches mapping mode's "Stage Sim" chip. */
  .minimize-btn.stage-sim-btn {
    width: auto;
    padding: 0 10px;
    gap: 7px;
    font-size: var(--vj-header-font);
    font-weight: 600;
    white-space: nowrap;
  }
  .minimize-btn {
    width: var(--vj-icon-btn);
    height: var(--vj-control-h);
    padding: 0;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    color: var(--ga-ink-1, #b8bdc6);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .minimize-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.30);
    color: var(--ga-ink-0, #eef0f4);
  }

  .exit-btn {
    height: var(--vj-control-h);
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    color: var(--ga-ink-1, #b8bdc6);
    padding: 0 calc(var(--vj-file-pad-x) + 2px);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    font-size: var(--vj-header-font);
    font-weight: 600;
    flex: 0 0 auto;
  }

  .exit-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.30);
    color: var(--ga-ink-0, #eef0f4);
  }

  .vj-header :is(button, select) {
    font-size: var(--vj-header-font);
  }
  .vj-header :is(.master-label, .header-quant-label) {
    font-size: var(--vj-label-font);
  }
  .vj-header :is(.master-value, .header-quant-select, .header-quant-pending) {
    font-size: calc(var(--vj-header-font) - 1px);
  }
  .vj-header .stage-mix-btn {
    font-size: var(--vj-header-font);
    padding: 0 var(--vj-stage-pad-x);
  }

  @media (min-width: 1800px) {
    .vj-overlay {
      --vj-header-h: 64px;
      --vj-header-pad-x: 18px;
      --vj-header-gap: 10px;
      --vj-half-gap: 5px;
      --vj-meter-gap: 8px;
      --vj-control-h: 34px;
      --vj-icon-btn: 34px;
      --vj-header-font: 14px;
      --vj-label-font: 12px;
      --vj-stage-pad-x: 16px;
      --vj-file-pad-x: 12px;
      --vj-master-slider-w: 72px;
      --vj-logo-h: 28px;
      --vj-macro-slot: 50px;
      --vj-macro-knob: 36px;
      --vj-macro-bank-w: 421px;
      --vj-macro-gap: 1px;
      --vj-macro-name-font: 10px;
      --vj-snap-font: 12px;
      --vj-snap-pad-x: 10px;
      --vj-aip-chevron-w: 16px;
      --vj-amp-bar-w: 5px;
      --vj-amp-bar-gap: 3px;
    }
  }

  @media (max-width: 1500px) {
    .vj-overlay {
      --vj-header-h: 54px;
      --vj-header-pad-x: 8px;
      --vj-header-gap: 5px;
      --vj-half-gap: 3px;
      --vj-meter-gap: 4px;
      --vj-right-gap: 3px;
      --vj-control-h: 28px;
      --vj-icon-btn: 28px;
      --vj-header-font: 12px;
      --vj-label-font: 10px;
      --vj-stage-pad-x: 9px;
      --vj-file-pad-x: 8px;
      --vj-master-slider-w: 44px;
      --vj-logo-h: 24px;
      --vj-macro-slot: 36px;
      --vj-macro-knob: 28px;
      --vj-macro-bank-w: 296px;
      --vj-macro-gap: 0px;
      --vj-macro-name-font: 8px;
      --vj-snap-font: 11px;
      --vj-snap-pad-x: 8px;
      --vj-aip-chevron-w: 13px;
      --vj-amp-bar-w: 4px;
      --vj-amp-bar-gap: 2px;
    }

    .master-value {
      min-width: 28px;
    }

    .header-quant-label {
      display: none;
    }

  }

  @media (max-width: 1280px) {
    .vj-overlay {
      --vj-header-pad-x: 7px;
      --vj-header-gap: 4px;
      --vj-meter-gap: 3px;
      --vj-right-gap: 2px;
      --vj-stage-pad-x: 7px;
      --vj-file-pad-x: 6px;
      --vj-master-slider-w: 40px;
      --vj-macro-slot: 34px;
      --vj-macro-bank-w: 280px;
      --vj-aip-chevron-w: 12px;
      --vj-amp-bar-w: 3px;
    }
  }

  /* Narrow: the macro bank drops to a second row spanning both columns. */
  @media (max-width: 1180px) {
    .vj-header {
      grid-template-columns: 1fr auto;
      row-gap: 3px;
      min-height: calc(var(--vj-header-h) + 38px);
    }

    .header-macros {
      grid-column: 1 / -1;
      grid-row: 2;
      width: 100%;
      max-width: none;
      justify-self: center;
    }
  }

  /* With audio live the header carries an extra ~200px cluster (scope,
     beat dots, TAP/BPM, mic, system audio, QUANT). Below this width that
     no longer fits on one line, and because the right cluster is last in
     the row it was Exit VJ that got pushed off the edge. Drop the macro
     bank onto its own line early instead — same reflow the narrow
     breakpoint already uses, just triggered while audio is on. */
  @media (max-width: 1560px) {
    .vj-header.audio-on {
      grid-template-columns: 1fr auto;
      row-gap: 3px;
      min-height: calc(var(--vj-header-h) + 38px);
    }

    .vj-header.audio-on .header-macros {
      grid-column: 1 / -1;
      grid-row: 2;
      width: 100%;
      max-width: none;
      justify-self: center;
    }
  }

  /* Main Layout */
  .vj-main {
    --vj-effects-center-offset: 236px;
    --vj-media-tray-center-offset: 348px;
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    padding-right: 348px;
    overflow: hidden;
  }

  .vj-main.tray-collapsed {
    --vj-media-tray-center-offset: 0px;
    padding-right: 0;
  }

  /* Preview Section - 3 columns: effects | preview | shader params */
  .vj-preview-section {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    padding: 8px;
    background: #0a0a0a;
    gap: 8px;
    min-height: 150px;
  }
  .vj-preview-section.reversed { flex-direction: row-reverse; }

  /* Resize handle between preview and grid */
  .preview-resize-handle {
    flex-shrink: 0;
    height: 6px;
    background: #1a1a1a;
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }

  .preview-resize-handle:hover,
  .preview-resize-handle:active {
    background: #2a2a2a;
  }

  .resize-grip {
    width: 40px;
    height: 2px;
    background: #555;
    border-radius: 1px;
  }

  .preview-resize-handle:hover .resize-grip {
    background: #888;
  }

  /* LEFT: Effects Panel */
  .effects-panel-vj {
    width: 270px;
    flex-shrink: 0;
    background: #0d1015;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .effects-tabs {
    display: flex;
    min-height: 36px;
    background: #15181f;
    border-bottom: 1px solid rgba(255, 255, 255, 0.10);
  }

  .fx-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 9px 6px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(238, 240, 244, 0.62);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
  }

  .fx-tab:hover {
    color: var(--text-primary, #ddd);
  }

  .fx-tab.active {
    color: var(--accent-primary, #BB86FC);
    border-bottom-color: var(--accent-primary, #BB86FC);
    background: rgba(187, 134, 252, 0.05);
  }

  .fx-tab svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }

  .effects-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .effects-panel-content::-webkit-scrollbar { width: 4px; }
  .effects-panel-content::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  .effects-info {
    margin-bottom: 8px;
  }

  .effects-info-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-primary, #BB86FC);
    letter-spacing: 0.5px;
  }

  .effects-info-hint {
    font-size: 10px;
    color: #555;
    margin: 2px 0 0;
  }

  .effects-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .effects-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted, #888);
  }

  .add-effect-btn {
    background: rgba(187, 134, 252, 0.1);
    border: 1px solid rgba(187, 134, 252, 0.3);
    color: var(--accent-primary, #BB86FC);
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .add-effect-btn:hover {
    background: rgba(187, 134, 252, 0.2);
    border-color: var(--accent-primary, #BB86FC);
  }

  /* Stage Effects tab — its own +Add row with a picker + button.
     Matches the existing effect-row aesthetic (compact, dark, accent
     cyan for stage-FX specifically since they're a different class
     of effect than the layer/clip post-fx). */
  .stage-fx-add {
    display: flex;
    gap: 6px;
    padding: 8px 6px;
    border-bottom: 1px solid #1d1d22;
    margin-bottom: 6px;
  }
  .stage-fx-select {
    flex: 1;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .stage-fx-select:focus {
    border-color: #4cd1ff;
    outline: none;
  }
  .stage-fx-icon {
    color: #4cd1ff;
    margin-right: 4px;
  }

  /* ── Stage Effects: automation transport ── */
  .stage-auto-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: linear-gradient(180deg, rgba(76,209,255,0.06), rgba(76,209,255,0.02));
    border-bottom: 1px solid rgba(76,209,255,0.18);
    margin-bottom: 4px;
  }
  .stage-auto-play {
    width: 30px; height: 26px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: #4cd1ff;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
  }
  .stage-auto-play:hover { background: rgba(76,209,255,0.12); border-color: #4cd1ff; }
  .stage-auto-play.playing {
    background: #4cd1ff;
    color: #0a0a0c;
    border-color: #4cd1ff;
  }
  .stage-auto-mode {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 12px;
    height: 26px;
  }
  .stage-auto-interval {
    width: 48px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 12px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    height: 26px;
  }
  .stage-auto-unit {
    color: var(--text-muted, #888);
    font-size: 11px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  /* ── Stage Effects: live-radio + cycle toggle on each row ── */
  .effect-live-radio {
    width: 22px; height: 22px;
    border: 1px solid #2a2a30;
    background: transparent;
    color: #555;
    border-radius: 50%;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .stage-effect-hold-button {
    position: relative;
    width: 24px; height: 22px;
    flex: 0 0 24px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    background:
      radial-gradient(circle at 35% 20%, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.06) 35%, transparent 60%),
      linear-gradient(180deg, #35353a 0%, #202026 46%, #0e0f13 100%);
    color: rgba(238, 242, 247, 0.82);
    cursor: pointer;
    padding: 0;
    display: inline-grid;
    place-items: center;
    overflow: hidden;
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.2),
      inset 0 -4px 6px rgba(0, 0, 0, 0.55),
      0 1px 2px rgba(0, 0, 0, 0.6);
    transform: translateY(0);
    transition: transform 80ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
  }

  .stage-effect-hold-button:hover {
    border-color: rgba(255, 255, 255, 0.34);
    color: #fff;
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.25),
      inset 0 -4px 6px rgba(0, 0, 0, 0.55),
      0 0 8px rgba(255, 255, 255, 0.08);
  }

  .stage-effect-hold-button.active {
    border-color: rgba(255, 133, 119, 0.48);
  }

  .stage-effect-hold-button.pressed {
    color: #fff;
    border-color: rgba(255, 147, 102, 0.95);
    background:
      radial-gradient(circle at 50% 42%, rgba(255, 244, 218, 0.95), rgba(255, 126, 69, 0.72) 45%, rgba(84, 24, 18, 0.88) 100%),
      linear-gradient(180deg, #4b1f18, #130b0a);
    box-shadow:
      inset 0 1px 2px rgba(255, 255, 255, 0.55),
      inset 0 -5px 8px rgba(0, 0, 0, 0.46),
      0 0 12px rgba(255, 110, 60, 0.72),
      0 0 24px rgba(255, 110, 60, 0.22);
    transform: translateY(1px);
  }

  .stage-effect-hold-light {
    position: absolute;
    inset: 4px;
    border-radius: 4px;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.14), transparent 72%);
    opacity: 0.8;
  }

  .stage-effect-hold-button.pressed .stage-effect-hold-light {
    background: radial-gradient(circle, rgba(255, 244, 214, 0.9), rgba(255, 111, 56, 0.52) 46%, transparent 78%);
    opacity: 1;
    filter: blur(1px);
  }

  .stage-effect-hold-icon {
    display: none;
  }

  .stage-effect-fire-icon {
    position: relative;
    z-index: 1;
    width: 13px;
    height: 13px;
    fill: currentColor;
  }

  .effect-live-radio:hover {
    border-color: #4cd1ff;
    color: var(--text-secondary, #aaa);
  }
  .effect-live-radio.active {
    color: #4cd1ff;
    border-color: #4cd1ff;
    background: rgba(76,209,255,0.12);
    box-shadow: 0 0 8px rgba(76,209,255,0.35);
  }
  .effect-cycle-toggle {
    background: transparent;
    border: 1px solid transparent;
    color: #555;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
  }
  .effect-cycle-toggle:hover { color: var(--text-secondary, #aaa); border-color: #2a2a30; }
  .effect-cycle-toggle.included {
    color: #4cd1ff;
    border-color: rgba(76,209,255,0.35);
  }
  .effect-item.live {
    background: rgba(76,209,255,0.04);
    border-left: 2px solid #4cd1ff;
  }

  .effects-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .effect-item {
    background: var(--bg-primary, #0d0d10);
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .effect-item.native-pending {
    border-color: rgba(255, 170, 64, 0.32);
    background: rgba(255, 170, 64, 0.045);
  }

  .effect-item + .effect-item {
    margin-top: 3px;
  }

  .effect-item.disabled { opacity: 0.4; }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .effect-header:hover { background: var(--bg-secondary, #111114); }

  .effect-toggle {
    background: none;
    border: none;
    color: var(--accent-primary, #BB86FC);
    font-size: 13px;
    cursor: pointer;
    padding: 2px;
    width: 18px;
    text-align: center;
  }

  .effect-toggle:not(.active) { color: #555; }

  .effect-name {
    flex: 1;
    font-size: 12px;
    color: var(--text-primary, #ddd);
    text-transform: capitalize;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .native-effect-badge {
    flex: 0 0 auto;
    border: 1px solid rgba(88, 231, 255, 0.38);
    background: rgba(88, 231, 255, 0.08);
    color: #58e7ff;
    border-radius: 3px;
    padding: 2px 5px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1;
  }

  .native-effect-badge.pending {
    border-color: rgba(255, 170, 64, 0.42);
    background: rgba(255, 170, 64, 0.1);
    color: #ffb85f;
  }

  .native-effect-lockout {
    border: 1px solid rgba(255, 170, 64, 0.28);
    background: rgba(255, 170, 64, 0.08);
    color: #ffcf91;
    border-radius: 4px;
    padding: 7px 8px;
    margin-bottom: 8px;
    font-size: 11px;
    line-height: 1.35;
  }

  .effect-expand {
    font-size: 9px;
    color: #666;
    padding: 2px;
  }

  .effect-delete {
    background: none;
    border: none;
    color: #555;
    font-size: 17px;
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .effect-header:hover .effect-delete { opacity: 1; }
  .effect-delete:hover { color: #ff4444; }

  .effect-params {
    padding: 8px 12px 10px;
    background: rgba(22, 22, 26, 0.8);
    border-top: 1px solid rgba(187, 134, 252, 0.1);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: #999;
    padding: 6px 0;
  }

  .param-row + .param-row {
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  .param-row .param-name,
  .param-row span:first-child {
    width: 56px;
    flex-shrink: 0;
    font-weight: 500;
    color: var(--text-secondary, #aaa);
    letter-spacing: 0.2px;
  }

  .param-row input[type="range"] {
    flex: 1;
    height: 6px;
    accent-color: var(--accent-primary, #BB86FC);
    border-radius: 3px;
    cursor: pointer;
  }

  .param-row input[type="range"]::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
  }

  .param-value {
    width: 38px;
    text-align: right;
    color: #777;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .no-effects {
    color: rgba(157, 177, 201, 0.78);
    font-size: 14px;
    text-align: center;
    padding: 28px 12px;
    line-height: 1.45;
  }

  .no-params {
    color: #555;
    font-style: italic;
  }

  /* CENTER: Preview wrapper + 16:9 container */
  .preview-wrapper {
    flex: 1;
    position: relative;
    min-width: 0;
  }

  .preview-container {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(50% + ((var(--vj-media-tray-center-offset) - var(--vj-effects-center-offset)) / 2));
    transform: translateX(-50%);
    height: 100%;
    aspect-ratio: 16 / 9;
    max-width: 100%;
    background: #000;
    border: 2px solid #333;
    border-radius: 4px;
    overflow: hidden;
  }

  /* Deck A/B confidence monitors — the layout wrapper is a passthrough
     until split-deck monitoring is active, so the native absolute
     centering above keeps working untouched. */
  .preview-layout {
    position: absolute;
    inset: 0;
  }

  .preview-wrapper.ab-monitoring .preview-layout {
    container-type: size;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
  }

  /* Fit the program box inside (available width − monitor stack) ×
     available height while KEEPING the output aspect — sizing from
     container units instead of flex-grow, because a flexed width plus
     a clamped max-height silently overrides aspect-ratio and
     stretches the picture. */
  .preview-wrapper.ab-monitoring .program-preview {
    position: relative;
    top: auto;
    bottom: auto;
    left: auto;
    transform: none;
    flex: 0 0 auto;
    aspect-ratio: 16 / 9;
    width: min(calc(100cqw - clamp(124px, 18vw, 220px) - 10px), calc(100cqh * 16 / 9));
    height: auto;
    max-width: none;
    max-height: 100%;
  }

  .deck-preview-stack {
    flex: 0 1 clamp(124px, 18vw, 220px);
    width: clamp(124px, 18vw, 220px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }

  .deck-preview-container {
    position: relative;
    aspect-ratio: 16 / 9;
    min-height: 0;
    overflow: hidden;
    background: #000;
    border: 1px solid rgba(154, 123, 255, 0.38);
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.75);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .deck-preview-container.deck-live {
    border-color: rgba(255, 115, 96, 0.9);
    box-shadow:
      0 0 10px rgba(255, 98, 80, 0.16),
      inset 0 0 0 1px rgba(255, 115, 96, 0.2);
  }

  /* The native presenter shows through this hole — keep the DOM box
     transparent so the Metal view beneath is visible. */
  .deck-monitor-hole {
    background: transparent;
  }

  .deck-preview-label {
    position: absolute;
    top: 5px;
    left: 5px;
    display: flex;
    align-items: center;
    gap: 5px;
    color: rgba(226, 231, 240, 0.78);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 8px;
    letter-spacing: 0;
    pointer-events: none;
  }

  .deck-preview-label strong {
    display: grid;
    place-items: center;
    width: 18px;
    height: 16px;
    color: #fff;
    background: rgba(0, 0, 0, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.24);
    font-size: 10px;
    line-height: 1;
  }

  @media (max-width: 1180px) {
    .preview-wrapper.ab-monitoring .preview-layout {
      gap: 6px;
    }

    .preview-wrapper.ab-monitoring .program-preview {
      width: min(calc(100cqw - 118px - 6px), calc(100cqh * 16 / 9));
    }

    .deck-preview-stack {
      flex-basis: 118px;
      width: 118px;
      gap: 5px;
    }
  }

  /* Full-native: the preview box is a transparent hole in the VJ overlay —
     the Metal underlay shows through wherever the whole DOM stack is
     transparent. Every VJ section paints its own opaque background, so only
     the ancestor chain above the preview box needs clearing; the window's
     opaque backdrop (#05070b) fills the remaining gaps. App.svelte hides the
     editor DOM while VJ mode is open in native so nothing bleeds through. */
  .vj-overlay.native-underlay {
    background: transparent;
  }
  /* Keep the VJ header clear of the macOS traffic-light strip — the app
     titlebar (30px, z-index 2000) always paints above this overlay. */
  .vj-overlay.mac-titlebar-offset {
    top: 30px;
  }
  .vj-overlay.native-underlay .vj-preview-section {
    background: transparent;
  }
  .preview-container.native-hole {
    background: transparent;
  }
  .preview-canvas.hidden-for-native {
    display: none;
  }

  .preview-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  .preview-label {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 10px;
    font-weight: 600;
    color: #555;
    background: rgba(0, 0, 0, 0.6);
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  }

  /* RIGHT: Shader Params Panel (above media tabs) */
  .right-panel-vj {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 348px;
    display: flex;
    flex-direction: column;
    background: var(--ga-panel, #0b0d11);
    border-left: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    overflow: visible;
    transition: width 0.2s ease;
    z-index: 12;
  }

  .right-panel-vj.collapsed {
    width: 0;
    padding: 0;
    border-left: 0;
    background: transparent;
    pointer-events: none;
  }

  .vj-right-tray-toggle {
    position: absolute;
    top: 12px;
    left: -46px;
    width: 46px;
    height: 64px;
    flex: 0 0 auto;
    background:
      linear-gradient(180deg, rgba(16, 38, 18, 0.98), rgba(5, 15, 8, 0.98));
    border: 1px solid rgba(57, 255, 20, 0.55);
    border-right: 0;
    border-radius: 8px 0 0 8px;
    color: #39ff14;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    box-shadow:
      0 0 18px rgba(57, 255, 20, 0.26),
      inset 0 1px 0 rgba(183, 255, 170, 0.28),
      inset -1px 0 0 rgba(57, 255, 20, 0.20);
    pointer-events: auto;
    z-index: 2;
  }

  .vj-right-tray-toggle:hover {
    color: #b7ffaa;
    border-color: rgba(57, 255, 20, 0.85);
    background:
      linear-gradient(180deg, rgba(26, 58, 25, 0.98), rgba(7, 23, 10, 0.98));
    box-shadow:
      0 0 24px rgba(57, 255, 20, 0.42),
      inset 0 1px 0 rgba(214, 255, 206, 0.34),
      inset -1px 0 0 rgba(57, 255, 20, 0.30);
  }

  .media-tray-glyph {
    width: 25px;
    height: 25px;
    overflow: visible;
    filter: drop-shadow(0 0 5px rgba(57, 255, 20, 0.65));
  }

  .media-tray-glyph .ghost-body {
    stroke: currentColor;
    stroke-width: 1.8;
    fill: rgba(57, 255, 20, 0.08);
  }

  .media-tray-glyph .ghost-mouth {
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .media-tray-glyph .ghost-eye {
    fill: currentColor;
    opacity: 0.95;
  }

  .media-tray-tab-label {
    font-size: 9px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: currentColor;
    text-shadow: 0 0 7px rgba(57, 255, 20, 0.72);
  }

  .vj-right-tray-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow: hidden;
  }

  .vj-clip-controls-stack {
    flex: 0 0 auto;
    max-height: 45%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }

  .vj-shared-media-host {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    background: var(--ga-panel, #0b0d11);
  }

  .vj-shared-media-host :global(.media-tray.embedded) {
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .shader-params-panel {
    background: #111;
    border: 1px solid #161618;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .shader-params-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #181818;
    border-bottom: 1px solid #161618;
    flex-shrink: 0;
  }

  .shader-params-overlay-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent-primary, #BB86FC);
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shader-params-layer-badge {
    font-size: 9px;
    padding: 1px 4px;
    background: var(--accent-primary, #BB86FC)30;
    border: 1px solid var(--accent-primary, #BB86FC)50;
    border-radius: 3px;
    color: var(--accent-primary, #BB86FC);
    font-weight: 700;
  }

  .js-animation-badge {
    background: rgba(92, 225, 230, 0.14);
    border-color: rgba(92, 225, 230, 0.42);
    color: #5ce1e6;
  }

  .js-color-param {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #777;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .js-color-param input {
    width: 42px;
    height: 24px;
    padding: 2px;
    border: 1px solid #333;
    border-radius: 3px;
    background: var(--bg-primary, #0d0d10);
    cursor: pointer;
  }

  .js-no-params {
    padding: 14px 10px;
    color: #666;
    font-size: 11px;
    text-align: center;
  }

  .shader-params-close {
    background: none;
    border: none;
    color: #666;
    font-size: 17px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .shader-params-close:hover {
    color: #ff4444;
  }

  /* ↺ Reset-all-params button. Cyan to read as recoverable + tonal-
     match the LayerPanel effect-reset button. Sits to the left of
     the close × button in the shader-params header. */
  .shader-params-reset {
    background: none;
    border: none;
    color: #7ec8e3;
    font-size: 15px;
    cursor: pointer;
    padding: 0 6px;
    line-height: 1;
    opacity: 0.6;
    margin-right: 2px;
  }
  .shader-params-reset:hover {
    opacity: 1;
  }

  .shader-params-panel-list {
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .shader-params-panel-list::-webkit-scrollbar { width: 4px; }
  .shader-params-panel-list::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  /* Bottom Section: Grid + Media Tray */
  .vj-bottom {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 200px;
  }

  /* Deck dock — fixed strip under the grid + media tray. */
  .vj-dock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--vj-header-gap);
    flex: 0 0 auto;
    box-sizing: border-box;
    padding: 5px var(--vj-header-pad-x);
    background: #141414;
    border-top: 1px solid #333;
    /* Popovers open upward out of this bar, so it can't clip them. */
    overflow: visible;
    position: relative;
    z-index: 15;
  }
  .vj-dock-group {
    display: flex;
    align-items: center;
    gap: var(--vj-meter-gap);
    min-width: 0;
  }
  .vj-dock-tools {
    gap: var(--vj-right-gap);
    flex: 0 0 auto;
  }
  .dock-quant {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 calc(var(--vj-file-pad-x) - 4px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    height: var(--vj-control-h);
  }
  .dock-quant-label {
    font-size: var(--vj-label-font);
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--ga-ink-1, #9aa0ac);
  }
  .dock-quant-select {
    background: #000;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    font-size: var(--vj-header-font);
    font-weight: 700;
    padding: 2px 4px;
    cursor: pointer;
  }
  /* Labelled dock buttons — icon + word, sized like the other dock chips. */
  .dock-labelled-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: auto;
    height: var(--vj-control-h);
    padding: 0 10px;
    font-size: var(--vj-header-font);
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .dock-quant-pending {
    font-size: var(--vj-label-font);
    font-weight: 700;
    color: #ffd166;
  }
  .vj-dock :global(.amp-strip),
  .vj-dock :global(.audio-input-picker) {
    gap: var(--vj-meter-gap);
  }
  .vj-dock :global(.amp-bandstrip) {
    gap: var(--vj-amp-bar-gap);
  }
  /* Media tray stays right; only the grid internals flip */

  /* Layer select icon */
  .layer-select-icon {
    width: 20px;
    height: 20px;
    background: #222;
    border: 1px solid #444;
    border-radius: 3px;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .layer-select-icon:hover {
    border-color: var(--accent-primary, #BB86FC);
    color: var(--accent-primary, #BB86FC);
  }

  .layer-select-icon.selected {
    background: var(--accent-primary, #BB86FC)20;
    border-color: var(--accent-primary, #BB86FC);
    color: var(--accent-primary, #BB86FC);
  }

  /* Grid Section */
  .grid-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: auto;
    background: #0e0e0e;
    padding: 12px;
  }

  .column-headers {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    position: sticky;
    top: 0;
    background: #0e0e0e;
    z-index: 10;
    padding-bottom: 8px;
    min-width: 100%;
    width: 100%;
    box-sizing: border-box;
  }

  .layer-controls-header {
    width: 150px;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .column-trigger {
    flex: 1 1 0;
    min-width: 76px;
    box-sizing: border-box;
    height: 28px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.1s;
  }

  .column-trigger:hover {
    background: var(--accent-primary, #BB86FC);
    border-color: var(--accent-primary, #BB86FC);
    color: #000;
  }

  .layer-row {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
    min-width: 100%;
    width: 100%;
    box-sizing: border-box;
  }

  /* Reversed layout: controls on right, clips flow left-to-right */
  .grid-section.reversed .column-headers { flex-direction: row-reverse; }
  .grid-section.reversed .layer-row { flex-direction: row-reverse; }

  .layer-row.selected .layer-controls {
    border-color: var(--accent-primary, #BB86FC);
  }

  .layer-controls {
    width: 150px;
    flex-shrink: 0;
    box-sizing: border-box;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .layer-controls:hover {
    border-color: #444;
  }

  .layer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .layer-num {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-muted, #888);
  }

  .layer-buttons {
    display: flex;
    gap: 2px;
  }

  .layer-btn {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s;
  }

  .layer-btn.solo {
    background: #333;
    color: #666;
  }

  .layer-btn.solo:hover {
    background: #444;
    color: #FFD54F;
  }

  .layer-btn.solo.active {
    background: #FFD54F;
    color: #000;
  }

  .layer-btn.mute {
    background: #333;
    color: #666;
  }

  .layer-btn.mute:hover {
    background: #444;
    color: #ff4444;
  }

  .layer-btn.mute.active {
    background: #ff4444;
    color: #fff;
  }

  .layer-btn.stop {
    background: #333;
    color: #666;
  }

  .layer-btn.stop:hover {
    background: #ff4444;
    color: #fff;
  }

  .opacity-slider {
    width: 100%;
    height: 18px;
    accent-color: var(--accent-primary, #BB86FC);
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    outline: none;
    margin: 0;
    padding: 0;
  }

  .opacity-slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 8px;
    background: #000000;
    border-radius: 4px;
    cursor: pointer;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent-primary, #BB86FC);
    cursor: pointer;
    border: 2px solid #111;
    margin-top: -5px;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.4);
  }

  .opacity-slider::-webkit-slider-thumb:hover {
    background: #9ef0ff;
    transform: scale(1.2);
    box-shadow: 0 0 8px rgba(187, 134, 252, 0.6);
  }

  .blend-select {
    width: 100%;
    background-color: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: var(--text-secondary, #aaa);
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }

  /* Clip Cells */
  .clip-cell {
    flex: 1 1 0;
    align-self: flex-start;
    aspect-ratio: 16 / 9;
    min-width: 76px;
    min-height: 60px;
    box-sizing: border-box;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.1s;
    position: relative;
    contain: layout paint;
  }

  .clip-cell:hover {
    border-color: #555;
  }

  .clip-cell.has-clip:hover {
    border-color: var(--accent-primary, #BB86FC);
  }

  .clip-cell.active {
    border-color: var(--accent-primary, #BB86FC);
    box-shadow: 0 0 12px rgba(187, 134, 252, 0.4);
  }

  /* Queued (waiting to fire on the next quantize boundary). Pulses the
     border so the user can see exactly which clips are armed without
     having to read the queue counter in the header. */
  .clip-cell.queued {
    border-color: #f97316;
    animation: cellQueuedPulse 0.7s ease-in-out infinite;
  }
  .clip-cell.queued.active {
    /* If the queued clip happens to be the currently-playing one,
       blend the two glows so it reads as "armed to re-trigger". */
    box-shadow: 0 0 14px rgba(249, 115, 22, 0.55), 0 0 12px rgba(187, 134, 252, 0.4);
  }
  @keyframes cellQueuedPulse {
    0%, 100% { box-shadow: 0 0 6px rgba(249, 115, 22, 0.45); }
    50%      { box-shadow: 0 0 18px rgba(249, 115, 22, 0.85); }
  }

  .clip-cell.dragover {
    border-color: var(--accent-primary, #BB86FC);
    background: #1a2530;
  }

  /* Wrong-mode cells: preset clips while in MIX/STAGE, or non-preset
     clips while in MAP. Still draggable (move/swap) and right-clickable
     (delete) — the onclick handler is short-circuited at the binding
     site. Visual cue is a heavy dim + a slash icon overlay so the user
     immediately reads "this clip can't fire in this mode" without
     reading any tooltip. Hover still subtly brightens so a quick scrub
     across the grid reveals what's there. */
  .clip-cell.wrong-mode {
    cursor: not-allowed;
  }
  .clip-cell.wrong-mode .clip-content {
    opacity: 0.28;
    filter: grayscale(0.65);
    transition: opacity 0.15s, filter 0.15s;
  }
  .clip-cell.wrong-mode:hover .clip-content {
    opacity: 0.45;
    filter: grayscale(0.35);
  }
  .clip-cell.wrong-mode::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(
        135deg,
        rgba(0, 0, 0, 0.0) 0px,
        rgba(0, 0, 0, 0.0) 6px,
        rgba(255, 255, 255, 0.04) 6px,
        rgba(255, 255, 255, 0.04) 7px
      );
    border-radius: inherit;
  }
  /* Suppress the active-glow on wrong-mode cells so the user doesn't
     read a dimmed-yellow cell as "currently firing" — the cell is
     dim and inert. Active highlight returns automatically when the
     mode matches again. */
  .clip-cell.wrong-mode.active {
    box-shadow: none;
    border-color: #333;
  }

  .clip-content {
    width: 100%;
    height: 100%;
    position: relative;
    min-width: 0;
    overflow: hidden;
  }

  .clip-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    min-width: 0;
    max-width: 100%;
    pointer-events: none;
  }

  .clip-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    min-width: 0;
  }

  .clip-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .clip-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .clip-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .clip-placeholder.spout {
    background: linear-gradient(135deg, #4a3a2a, #3a2a2a);
    color: #ffa050;
  }

  .clip-placeholder.threejs {
    background: linear-gradient(135deg, #2a4a4a, #2a3a3a);
    color: #50c0c0;
  }

  .clip-placeholder.splat {
    background: linear-gradient(135deg, #1a3a2a, #2a3a2a);
    color: #34d399;
  }

  .clip-placeholder.model3d {
    background: linear-gradient(135deg, #3a3a1a, #3a2a1a);
    color: #fbbf24;
  }

  .clip-placeholder.effect {
    background: linear-gradient(135deg, #2a2a4a, #2a2a3a);
    color: #a78bfa;
  }

  .clip-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.8);
    font-size: 9px;
    color: var(--text-secondary, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    pointer-events: none;
  }

  .clear-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    background: rgba(255, 50, 50, 0.9);
    border: none;
    border-radius: 50%;
    color: #fff;
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
    padding: 0;
    line-height: 1;
  }

  .clip-cell:hover .clear-btn {
    opacity: 1;
  }

  .empty-cell {
    width: 100%;
    height: 100%;
  }

  /* Context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ctx-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-tertiary, #1a1a1e);
    border: 1px solid #333;
    border-radius: 4px;
    padding: 4px 0;
    min-width: 100px;
    box-shadow: 0 4px 12px rgba(0,0,0,.5);
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .ctx-item:hover {
    background: rgba(255,255,255,.08);
    color: #fff;
  }
  .ctx-danger { color: #ff6b6b; }
  .ctx-danger:hover { background: rgba(255,80,80,.12); color: #ff4444; }
  .ctx-disabled { color: #555; cursor: default; }
  .ctx-disabled:hover { background: none; color: #555; }
  /* Highlighted "primary" menu item — used for the most-likely action like
     "Save Project" or "Update Preset" so it stands out in the menu. */
  .ctx-primary {
    color: #FF8577;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .ctx-primary:hover {
    background: rgba(255, 133, 119, 0.12);
    color: #ffa899;
  }
  .ctx-shortcut {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: var(--text-muted, #888);
    font-weight: 400;
  }
  .ctx-separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }

  /* Media Tray (compact, matching mapping mode) */
  .media-tray-vj {
    width: 220px;
    background: var(--bg-secondary, #111114);
    border-left: 1px solid #161618;
    display: none;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s ease;
  }

  .media-tray-vj.collapsed {
    width: 40px;
    min-width: 40px;
  }

  .tray-collapse-btn {
    width: 100%;
    height: 36px;
    background: var(--bg-secondary, #111114);
    border: none;
    border-bottom: 1px solid #161618;
    color: var(--text-muted, #888);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .tray-collapse-btn:hover {
    color: var(--accent-primary, #BB86FC);
  }

  /* VJ Tab Row (matching mapping mode icons) */
  .vj-tabs {
    background: var(--bg-primary, #0d0d10);
    border-bottom: 1px solid #161618;
  }

  .vj-tab-row {
    display: flex;
  }

  .vj-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px 6px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #666;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
    position: relative;
  }

  .vj-tab:hover {
    color: var(--text-secondary, #aaa);
    background: rgba(187, 134, 252, 0.03);
  }

  .vj-tab.active {
    color: var(--accent-primary, #BB86FC);
    border-bottom-color: var(--accent-primary, #BB86FC);
    background: rgba(187, 134, 252, 0.06);
  }

  .vj-tab svg {
    opacity: 0.7;
  }

  .vj-tab.active svg {
    opacity: 1;
  }

  .vj-tab-count {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 9px;
    color: #555;
    font-weight: 600;
  }

  .vj-tab.active .vj-tab-count {
    color: var(--accent-primary, #BB86FC);
  }

  .vj-tab-count.live {
    color: #22c55e;
  }

  /* AI Generator Section */
  .vj-ai-section {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    background: var(--bg-primary, #0d0d10);
    border-bottom: 1px solid #161618;
  }

  .vj-ai-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    background: linear-gradient(135deg, #2a1a3a, #1a2a3a);
    border: 1px solid #a855f740;
    border-radius: 4px;
    color: #a855f7;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-ai-btn:hover {
    border-color: #a855f7;
    background: linear-gradient(135deg, #3a2a4a, #2a3a4a);
  }

  .vj-ai-video-btn {
    background: linear-gradient(135deg, #1a2a3a, #1a3a2a);
    border-color: #3b82f640;
    color: #3b82f6;
  }

  .vj-ai-video-btn:hover {
    border-color: #3b82f6;
    background: linear-gradient(135deg, #2a3a4a, #2a4a3a);
  }

  .vj-ai-container {
    border-bottom: 1px solid #161618;
    max-height: 300px;
    overflow-y: auto;
  }

  .loading {
    padding: 12px;
    font-size: 12px;
    color: #666;
    text-align: center;
  }

  .media-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: 80px;
    gap: 4px;
    align-content: start;
    position: relative;
    transition: background 0.15s, outline-color 0.15s;
    outline: 2px dashed transparent;
    outline-offset: -4px;
  }
  .media-list.vj-media-drag-over {
    background: rgba(120, 180, 255, 0.08);
    outline-color: rgba(120, 180, 255, 0.6);
  }
  .vj-import-bar {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .vj-import-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 10px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: var(--text-primary, #ddd);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .vj-import-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }

  .empty-media {
    text-align: center;
    color: #444;
    padding: 20px 12px;
    grid-column: 1 / -1;
  }

  .empty-media p {
    margin: 0;
    font-size: 12px;
  }

  .empty-media .hint {
    font-size: 10px;
    color: #333;
    margin-top: 8px;
  }

  .media-item {
    position: relative;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .media-item:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .media-item.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .item-thumb {
    width: 100%;
    height: 100%;
  }

  .item-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
  }

  .thumb-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .thumb-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .thumb-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .thumb-placeholder.threejs {
    background: linear-gradient(135deg, #4a3a2a, #3a2a1a);
    color: #c0a080;
  }

  .item-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.8);
  }

  .item-name {
    font-size: 10px;
    color: var(--text-primary, #eee);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-type {
    font-size: 9px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
  }

  /* Scrollbar */
  .media-list::-webkit-scrollbar,
  .grid-section::-webkit-scrollbar {
    width: 6px;
  }

  .media-list::-webkit-scrollbar-track,
  .grid-section::-webkit-scrollbar-track {
    background: #141414;
  }

  .media-list::-webkit-scrollbar-thumb,
  .grid-section::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }

  .media-list::-webkit-scrollbar-thumb:hover,
  .grid-section::-webkit-scrollbar-thumb:hover {
    background: #444;
  }

  /* Blocks Tab Bar */
  .blocks-tab-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 4px 0;
  }

  .blocks-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }

  .grid-snaps {
    display: flex;
    align-items: center;
    margin-left: auto;
    flex: 0 0 auto;
    position: relative;
    z-index: 12;
  }

  .blocks-tabs::-webkit-scrollbar {
    height: 4px;
  }

  .blocks-tabs::-webkit-scrollbar-track {
    background: #141414;
  }

  .blocks-tabs::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 2px;
  }

  .block-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    min-width: 80px;
  }

  .block-tab:hover {
    background: var(--bg-secondary, #111114);
    border-color: #444;
  }

  .block-tab.active {
    background: var(--accent-primary, #BB86FC);
    border-color: var(--accent-primary, #BB86FC);
    color: #000;
  }

  .block-tab.active .block-name {
    color: #000;
  }

  .block-tab.dragover {
    border-color: var(--accent-primary, #BB86FC);
    box-shadow: 0 0 0 1px rgba(187, 134, 252, 0.55), 0 0 12px rgba(187, 134, 252, 0.22);
    transform: translateY(-1px);
  }

  .block-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #aaa);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .block-name-input {
    background: #111;
    border: 1px solid var(--accent-primary, #BB86FC);
    border-radius: 3px;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 2px 6px;
    width: 80px;
    outline: none;
  }

  .block-delete-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 50%;
    opacity: 0;
    transition: all 0.1s;
  }

  .block-tab:hover .block-delete-btn {
    opacity: 1;
  }

  .block-delete-btn:hover {
    background: rgba(255, 68, 68, 0.3);
    color: #ff4444;
  }

  .block-tab.active .block-delete-btn {
    color: #333;
  }

  .block-tab.active .block-delete-btn:hover {
    background: rgba(0, 0, 0, 0.2);
    color: #000;
  }

  .add-block-btn {
    width: 28px;
    height: 28px;
    background: #222;
    border: 1px dashed #444;
    border-radius: 4px;
    color: #666;
    font-size: 19px;
    font-weight: 300;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-block-btn:hover {
    background: #333;
    border-color: var(--accent-primary, #BB86FC);
    color: var(--accent-primary, #BB86FC);
  }

  /* Layer Live Preview */
  .layer-live-preview {
    width: 56px;
    height: 42px;
    flex-shrink: 0;
    box-sizing: border-box;
    background: #0a0a0a;
    border: 2px solid #222;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  }

  .layer-live-preview:active {
    cursor: grabbing;
  }

  .layer-live-preview.has-clip {
    border-color: var(--accent-primary, #BB86FC);
    box-shadow: 0 0 8px rgba(187, 134, 252, 0.3);
  }

  .live-preview-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .live-preview-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }

  .live-preview-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .live-preview-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .live-preview-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .live-preview-placeholder.spout {
    background: linear-gradient(135deg, #4a3a2a, #3a2a2a);
    color: #ffa050;
  }

  .live-preview-placeholder.threejs {
    background: linear-gradient(135deg, #2a4a4a, #2a3a3a);
    color: #50c0c0;
  }

  .live-preview-empty {
    color: #333;
    font-size: 15px;
  }

  .live-indicator-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    background: #ff3333;
    border-radius: 50%;
    animation: blink 1s infinite;
  }

  /* Layer Row Dragging */
  .layer-row {
    cursor: grab;
  }

  .layer-row:active {
    cursor: grabbing;
  }

  .layer-row.dragging {
    opacity: 0.5;
    background: var(--bg-primary, #0d0d10);
  }

  .layer-row.drag-over {
    border-top: 2px solid var(--accent-primary, #BB86FC);
    margin-top: -2px;
  }

  .live-preview-header {
    width: 56px;
    flex-shrink: 0;
    box-sizing: border-box;
    font-size: 10px;
    font-weight: 600;
    color: #666;
    text-align: center;
    padding: 4px 0;
  }

  /* Sources Filter */
  .sources-filter-btn {
    position: relative;
  }

  .vj-live-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: #22c55e;
    color: #000;
    font-size: 9px;
    font-weight: 700;
    margin-left: 3px;
    vertical-align: middle;
  }

  .vj-sources-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    grid-column: 1 / -1;
  }

  .vj-sources-btns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .vj-src-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 32px;
    padding: 7px 6px;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-src-btn:hover {
    border-color: var(--accent-primary, #BB86FC);
    color: var(--accent-primary, #BB86FC);
    background: #1a2a2d;
  }

  .spout-btn:hover,
  .spout-btn.active {
    border-color: #a78bfa;
    color: #a78bfa;
    background: #1e1a2d;
  }

  .vj-spout-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: #151515;
    border: 1px solid #333;
    border-radius: 4px;
  }

  .vj-spout-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vj-spout-sender {
    padding: 5px 8px;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 3px;
    color: var(--text-primary, #ccc);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .vj-spout-sender:hover {
    border-color: #a78bfa;
    color: #a78bfa;
  }

  .vj-spout-manual {
    display: flex;
    gap: 3px;
  }

  .vj-spout-input {
    flex: 1;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 3px;
    color: var(--text-primary, #ccc);
    padding: 5px 6px;
    font-size: 11px;
  }

  .vj-spout-input:focus {
    outline: none;
    border-color: #a78bfa;
  }

  .vj-spout-connect {
    padding: 5px 8px;
    background: #a78bfa20;
    border: 1px solid #a78bfa;
    border-radius: 3px;
    color: #a78bfa;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .vj-spout-connect:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .vj-source-item {
    position: relative;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 54px;
    padding: 7px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    cursor: grab;
    transition: border-color 0.15s, background 0.15s, transform 0.15s;
  }

  .vj-source-item:hover {
    border-color: rgba(120, 180, 255, 0.45);
    background: rgba(120, 180, 255, 0.08);
  }

  .vj-source-item.source-pending {
    cursor: progress;
    opacity: 0.72;
  }

  .vj-source-item.source-live {
    border-left: 2px solid #22c55e;
  }

  .vj-live-source-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-thumb {
    width: 42px;
    height: 36px;
    border-radius: 3px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.08);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .source-type-icon {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent-primary, #BB86FC);
    letter-spacing: 0.5px;
  }

  .thumb-live-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e80;
  }

  .source-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .source-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary, #ddd);
    font-size: 12px;
  }

  .source-status {
    color: var(--text-muted, #777);
    font-size: 10px;
    text-transform: uppercase;
  }

  .source-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .vj-src-add,
  .vj-src-stop {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0,0,0,0.6);
    color: var(--text-muted, #888);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-src-add {
    color: #8fd6ff;
    background: rgba(76, 209, 255, 0.1);
    border-color: rgba(76, 209, 255, 0.24);
    font-size: 16px;
    line-height: 1;
  }

  .vj-src-add:hover:not(:disabled) {
    color: #d9f5ff;
    background: rgba(76, 209, 255, 0.2);
    border-color: rgba(76, 209, 255, 0.5);
  }

  .vj-src-add:disabled {
    opacity: 0.35;
    cursor: progress;
  }

  .vj-src-stop:hover {
    color: #f44;
    background: rgba(255,68,68,0.2);
  }

  .capture-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(4px);
  }

  .capture-picker-modal {
    width: min(1100px, 92vw);
    height: min(760px, 82vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #141418;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #e8e8ea;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .cpm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 0 0 auto;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .cpm-title {
    font-size: 15px;
    font-weight: 600;
  }

  .cpm-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-secondary, #aaa);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    cursor: pointer;
  }

  .cpm-close:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.3);
  }

  .cpm-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding-bottom: 14px;
  }

  .cpm-loading,
  .cpm-empty {
    padding: 40px;
    text-align: center;
    color: var(--text-muted, #888);
    font-size: 14px;
  }

  .cpm-section-title {
    padding: 16px 18px 6px;
    color: var(--text-muted, #888);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.1px;
  }

  .cpm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    padding: 6px 18px 18px;
  }

  .cpm-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    background: #1c1c22;
    color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms, background 120ms;
  }

  .cpm-card:hover {
    background: #1f1c2a;
    border-color: #BB86FC;
  }

  .cpm-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: #08080a;
    border-radius: 4px;
  }

  .cpm-thumb-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #777);
    font-size: 12px;
  }

  .cpm-name,
  .cpm-name-row {
    min-width: 0;
  }

  .cpm-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cpm-app-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    border-radius: 3px;
  }

  .cpm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary, #ddd);
    font-size: 13px;
  }

  /* ========== Audio Control Bar ========== */
  /* Audio bar styles moved to VJAudioBar.svelte (see extraction note in template) */

  /* ========== Shader Parameters ========== */
  .active-clip-name {
    font-size: 11px;
    color: var(--accent-primary, #BB86FC);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .shader-params-section {
    border-bottom: 1px solid #161618;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }

  .section-header {
    padding: 6px 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-primary, #BB86FC);
    letter-spacing: 0.5px;
  }

  .shader-params-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shader-param {
    padding: 4px 0;
    border-left: 2px solid transparent;
    padding-left: 6px;
  }

  .shader-param.modulated {
    border-left-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
    border-radius: 0 4px 4px 0;
  }

  .shader-param-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 3px;
  }

  .shader-param-name {
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .mod-source-chip {
    font-size: 10px;
    padding: 1px 8px;
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 3px;
    color: #666;
    cursor: pointer;
    max-width: 78px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .mod-source-chip:hover {
    border-color: #777;
    color: #bbb;
  }

  .mod-source-chip.active {
    border-color: #a855f7;
    color: #a855f7;
    background: #1a1a2a;
  }

  .mod-source-chip.open {
    border-color: #a855f7;
    box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.35);
  }

  .shader-param-slider {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Per-param auto transport/speed controls moved into the ModTray
     popover; only the range slippers remain on the slider track. */

  .slider-track-wrap {
    position: relative;
    flex: 1;
    /* Extra vertical space when slippers overlay — keeps the cyan
       thumbs visible above/below the main slider line. */
    min-height: 14px;
    display: flex;
    align-items: center;
  }

  .param-slider {
    width: 100%;
    height: 3px;
    accent-color: var(--accent-primary, #BB86FC);
  }

  /* ─── Auto-mode slippers (overlay on slider track) ─── */
  /* Two range inputs positioned absolutely over the main slider so
     their 0..1 thumb positions line up exactly with the main
     slider's input.MIN..input.MAX. Tracks are invisible so the
     main slider shows through; only the cyan thumbs are visible.
     The filled bar between thumbs highlights the active sweep
     range. pointer-events: none on the input itself with auto on
     the thumb pseudo-element lets users click the main slider's
     track without the slippers eating the click. */
  .slipper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .slipper::-webkit-slider-runnable-track { background: transparent; height: 100%; }
  .slipper::-moz-range-track             { background: transparent; height: 100%; }
  .slipper::-webkit-slider-thumb {
    -webkit-appearance: none;
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
  }
  .slipper::-moz-range-thumb {
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
  }
  .slipper-fill {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 5px;
    background: rgba(92, 225, 230, 0.18);
    border-top: 1px solid rgba(92, 225, 230, 0.4);
    border-bottom: 1px solid rgba(92, 225, 230, 0.4);
    pointer-events: none;
    z-index: 1;
  }
  .auto-val-grow { min-width: 0; flex: 1; text-align: left; color: #5ce1e6; opacity: 0.75; }

  .mod-ghost {
    position: absolute;
    top: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5ce1e6;
    box-shadow: 0 0 6px #5ce1e6;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
    transition: left 0.03s linear;
  }

  .param-val {
    font-size: 10px;
    color: #555;
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: right;
  }

  .shader-param-toggle {
    display: flex;
  }

  .bool-toggle {
    padding: 2px 10px;
    border: 1px solid #333;
    border-radius: 3px;
    background: var(--bg-primary, #0d0d10);
    color: #666;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s;
  }

  .bool-toggle.on {
    background: #1a3a1a;
    border-color: #22c55e;
    color: #22c55e;
  }

  .shader-param-select {
    display: flex;
  }

  .long-select {
    width: 100%;
    font-size: 11px;
    padding: 5px 8px;
    background-color: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 3px;
    color: var(--text-secondary, #aaa);
  }

  .audio-ready-badge {
    display: inline-block;
    font-size: 11px;
    color: #5ce1e6;
    background: rgba(92, 225, 230, 0.15);
    border: 1px solid rgba(92, 225, 230, 0.3);
    border-radius: 3px;
    padding: 0 4px;
    margin-left: 4px;
    line-height: 1.4;
    vertical-align: middle;
  }

  .audio-warn {
    font-size: 10px;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 3px;
    padding: 4px 6px;
    margin: 0 0 6px 0;
    line-height: 1.4;
  }

  /* Depth / Speed rows moved into the ModTray popover. */

  /* Performer atom icon — compact 32×28 button matching the other
     header-right icons (settings/minimize/blackout shape). Purple to
     keep the SynthVision/Performer brand color. Idle = translucent
     outline; .active = solid purple glow; .running (idle but the
     overlay was opened earlier) = green pulse so the user knows the
     keyboard launcher is still alive in the background. */
  .performer-atom-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--vj-icon-btn);
    height: var(--vj-control-h);
    padding: 0;
    background: rgba(187, 134, 252, .08);
    border: 1px solid rgba(187, 134, 252, .25);
    border-radius: 4px;
    color: var(--accent-primary, #BB86FC);
    cursor: pointer;
    transition: background .15s, border-color .15s, color .15s, box-shadow .15s, transform .08s;
  }
  .performer-atom-btn svg {
    /* Slow continuous spin so the atom feels alive even when idle.
       Only runs while the VJ overlay is open (the entire panel is
       conditionally rendered, so the animation doesn't burn CPU in
       mapping mode). transform-box+transform-origin pinned to ensure
       webkit doesn't rotate around (0,0). */
    animation: performer-atom-spin 12s linear infinite;
    transform-box: fill-box;
    transform-origin: 50% 50%;
  }
  /* Honor reduced-motion preference — disable the spin entirely so
     vestibular-sensitive users don't get a constantly rotating
     icon in their field of view. */
  @media (prefers-reduced-motion: reduce) {
    .performer-atom-btn svg { animation: none; }
  }
  .performer-atom-btn:hover {
    background: rgba(187, 134, 252, .18);
    border-color: rgba(187, 134, 252, .5);
    color: #DAB6FF;
  }
  .performer-atom-btn:active { transform: scale(.94); }
  .performer-atom-btn.active {
    background: rgba(187, 134, 252, .22);
    border-color: rgba(187, 134, 252, .7);
    color: #fff;
    box-shadow: 0 0 12px rgba(187, 134, 252, .55);
  }
  .performer-atom-btn.active svg { animation-duration: 4s; }
  @keyframes performer-atom-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* Performer Overlay - aligns exactly over vj-bottom section */
  .performer-overlay {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    /* top is set dynamically via inline style */
    z-index: 1001; /* Above vj-overlay (z-index: 1000) */
    animation: performer-slide-up .25s ease-out;
    display: flex;
    flex-direction: column;
  }

  .performer-resize-handle {
    flex-shrink: 0;
    height: 8px;
    background: #111;
    border-bottom: 1px solid #333;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    touch-action: none;
  }

  .performer-resize-handle:hover,
  .performer-resize-handle:active {
    background: #222;
  }

  .performer-resize-handle .resize-grip {
    width: 48px;
    height: 3px;
    background: #555;
    border-radius: 2px;
  }

  .performer-resize-handle:hover .resize-grip {
    background: #999;
  }
  .performer-overlay.hidden {
    pointer-events: none;
    opacity: 0;
    transform: translateY(100%);
    transition: opacity .2s, transform .25s;
  }
  @keyframes performer-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Performer atom running state — overlay was opened earlier and is
     still alive but currently minimized. Green pulse so the user knows
     they have a SynthVision session running in the background. */
  .performer-atom-btn.running {
    background: rgba(105, 240, 174, .12);
    border-color: rgba(105, 240, 174, .4);
    color: #69F0AE;
    animation: sv-pulse 2s ease-in-out infinite;
  }
  .performer-atom-btn.running svg { animation-duration: 6s; }
  @keyframes sv-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(105, 240, 174, .2); }
    50% { box-shadow: 0 0 12px rgba(105, 240, 174, .4); }
  }

  /* Plugin Panel Styles */
  .vj-plugins-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* App-native VJ plugin card — matches MediaTray's coral-on-dark style.
     One uniform look for every visualizer engine; the per-type icon
     classes still set the SVG color but everything else stays unified. */
  .vj-plugin-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    background: #0a0a0d;
    border: 1px solid rgba(255, 107, 107, 0.10);
    border-radius: 6px;
    cursor: grab;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }

  .vj-plugin-card:hover {
    border-color: rgba(255, 107, 107, 0.55);
    background: #100a0c;
    box-shadow: 0 0 0 1px rgba(255, 107, 107, 0.06), 0 0 10px rgba(255, 107, 107, 0.10);
  }

  .vj-plugin-card:hover .vj-plugin-icon {
    color: var(--accent-primary, #FF6B6B);
    filter: drop-shadow(0 0 4px rgba(255, 107, 107, 0.4));
  }

  .vj-plugin-card.running {
    border-color: var(--accent-primary, #FF6B6B);
    background: rgba(255, 107, 107, 0.05);
  }

  .vj-plugin-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    background: var(--bg-primary, #050507);
    border: 1px solid rgba(255, 107, 107, 0.08);
    color: var(--accent-secondary, #FF8585);
    transition: color 0.15s, filter 0.15s;
  }

  /* Per-type classes kept for selector specificity, but all share the
     same coral tint so the row reads as one cohesive set of options. */
  .vj-plugin-icon.fluid,
  .vj-plugin-icon.particles,
  .vj-plugin-icon.milkdrop,
  .vj-plugin-icon.audiomotion,
  .vj-plugin-icon.wavejs,
  .vj-plugin-icon.hydra,
  .vj-plugin-icon.ghostfx {
    color: var(--accent-secondary, #FF8585);
  }

  /* Splat / Model3D param panel details sections */
  .shader-params-panel details {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .shader-params-panel summary {
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    user-select: none;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .shader-params-panel summary:hover {
    color: var(--text-primary, #ddd);
    background: rgba(255, 255, 255, 0.03);
  }

  .shader-params-panel details[open] summary {
    color: #bb86fc;
    border-bottom: 1px solid rgba(187, 134, 252, 0.1);
  }

  .shader-params-panel details > div {
    padding: 4px 8px 8px;
  }

  .shader-params-panel .param-row select {
    flex: 1;
    background-color: #1a1a1e;
    border: 1px solid #333;
    color: var(--text-primary, #ccc);
    border-radius: 3px;
    font-size: 12px;
    padding: 2px 4px;
  }

  .splat-params-panel {
    border-color: rgba(52, 211, 153, 0.2);
  }

  .model3d-params-panel {
    border-color: rgba(251, 191, 36, 0.2);
  }

  .vj-plugin-icon.splat,
  .vj-plugin-icon.model3d {
    color: var(--accent-secondary, #FF8585);
    background: var(--bg-primary, #050507);
    border: 1px solid rgba(255, 107, 107, 0.08);
  }

  .vj-plugin-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vj-plugin-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }

  .vj-plugin-desc {
    font-size: 11px;
    color: var(--text-muted, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .vj-plugin-status {
    font-size: 10px;
    color: #666;
  }

  .vj-plugin-status.live {
    color: #4ade80;
  }

  .vj-plugin-actions {
    flex-shrink: 0;
  }

  .vj-plugin-btn {
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid transparent;
  }

  .vj-plugin-btn.start {
    background: linear-gradient(135deg, #166534, #15803d);
    color: #4ade80;
    border-color: #22c55e;
  }

  .vj-plugin-btn.start:hover {
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.3);
  }

  .vj-plugin-btn.stop {
    background: linear-gradient(135deg, #7f1d1d, #991b1b);
    color: #f87171;
    border-color: #ef4444;
  }

  .vj-plugin-btn.stop:hover {
    box-shadow: 0 0 8px rgba(248, 113, 113, 0.3);
  }

  .vj-plugin-hint {
    text-align: center;
    padding: 12px;
    color: #555;
    font-size: 11px;
  }

  .vj-plugin-hint p {
    margin: 2px 0;
  }

  /* ── Grid Dimension Controls ── */
  .grid-dimension-controls {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 0;
    margin-bottom: 8px;
  }

  .dim-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .dim-label {
    font-size: 11px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
  }

  .dim-btn {
    width: 22px;
    height: 22px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: var(--text-primary, #ccc);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
  }

  .dim-btn:hover {
    background: var(--accent-primary, #BB86FC);
    border-color: var(--accent-primary, #BB86FC);
    color: #000;
  }

  .dim-value {
    font-size: 13px;
    color: #fff;
    font-weight: 600;
    min-width: 20px;
    text-align: center;
  }

  .stage-toggle {
    margin-left: auto;
    padding: 4px 12px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .stage-toggle:hover {
    border-color: #f90;
    color: #f90;
  }

  .stage-toggle.active {
    background: #f90;
    border-color: #f90;
    color: #000;
  }

  /* ── Stage Presets Bar ── */
  .stage-presets-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 20px;
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
    background: #141414;
    flex-shrink: 0;
  }

  .stage-presets-label {
    font-size: 11px;
    color: #f90;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .stage-presets-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    flex: 1;
  }

  .stage-preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    min-width: 60px;
    transition: all 0.15s;
  }

  .stage-preset-btn:hover {
    border-color: #f90;
    color: #fff;
  }

  .stage-preset-btn.active {
    border-color: #f90;
    background: #2a1a00;
    color: #f90;
  }

  .stage-preset-thumb {
    width: 48px;
    height: 28px;
    object-fit: cover;
    border-radius: 2px;
  }

  .stage-preset-name {
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage-preset-name-input {
    width: 70px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #4cd1ff;
    color: #fff;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .stage-preset-save-btn {
    padding: 4px 10px;
    background: #222;
    border: 1px dashed #555;
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .stage-preset-save-btn:hover {
    border-color: #f90;
    color: #f90;
  }

  /* Update-active-preset button — outlined cyan, distinct from
     "+ Save" so the destructive overwrite isn't reached by muscle
     memory. Filled on hover to confirm intent. */
  .stage-preset-update-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid #4cd1ff;
    border-radius: 4px;
    color: #4cd1ff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .stage-preset-update-btn:hover {
    background: rgba(76,209,255,0.15);
    color: #fff;
  }

  .stage-scope-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    padding: 0;
    border: 1px solid rgba(57, 255, 20, 0.34);
    border-radius: 5px;
    background: rgba(57, 255, 20, 0.06);
    color: #39ff14;
    cursor: pointer;
    flex-shrink: 0;
    filter: drop-shadow(0 0 8px rgba(57, 255, 20, 0.16));
    transition: background 0.14s, border-color 0.14s, box-shadow 0.14s, color 0.14s;
  }
  .stage-scope-toggle:hover {
    background: rgba(57, 255, 20, 0.12);
    border-color: rgba(57, 255, 20, 0.7);
    box-shadow: 0 0 14px rgba(57, 255, 20, 0.24);
  }
  .stage-scope-toggle.global {
    border-color: rgba(57, 255, 20, 0.56);
    background: rgba(57, 255, 20, 0.1);
  }
  .stage-scope-icon {
    width: 16px;
    height: 16px;
    color: inherit;
    overflow: visible;
    filter: drop-shadow(0 0 6px rgba(57, 255, 20, 0.62));
  }
  .stage-scope-icon .scope-stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .stage-scope-icon .scope-fill {
    fill: currentColor;
    opacity: 0.16;
  }
  .stage-preset-scope {
    font-size: 9px;
    font-weight: bold;
    color: rgba(100,200,255,0.8);
    margin-right: 2px;
  }

  /* ── A/B crossfader ──────────────────────────────────────────────── */
  .stage-mix-btn.xfade-toggle.active {
    background: linear-gradient(135deg, rgba(255, 133, 119, 0.3), rgba(126, 200, 227, 0.3));
    border-color: rgba(255, 133, 119, 0.7);
    color: #fff;
    text-shadow: 0 0 8px rgba(255, 133, 119, 0.8);
  }

  /* The bar itself sits flush above the column-headers row */
  .xfade-bar {
    background: linear-gradient(180deg, rgba(20, 20, 28, 0.95), rgba(15, 15, 22, 0.98));
    border: 1px solid rgba(126, 200, 227, 0.18);
    border-radius: 6px;
    padding: 8px 12px 10px;
    margin-bottom: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  }

  .xfade-controls-row {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }

  .xfade-cut-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #d4d4d4;
    border-radius: 5px;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.15s;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .xfade-cut-btn:hover {
    background: rgba(255, 133, 119, 0.18);
    color: #fff;
    border-color: rgba(255, 133, 119, 0.4);
  }
  .xfade-cut-btn.cut-a:hover {
    background: linear-gradient(90deg, rgba(255, 133, 119, 0.28), transparent);
  }
  .xfade-cut-btn.cut-b:hover {
    background: linear-gradient(90deg, transparent, rgba(126, 200, 227, 0.28));
  }

  .xfade-transition-selector {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    justify-content: center;
  }
  .xfade-trans-arrow {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    width: 22px;
    height: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    transition: all 0.15s;
  }
  .xfade-trans-arrow:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
  .xfade-trans-select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(126, 200, 227, 0.25);
    color: #fff;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    min-width: 110px;
    cursor: pointer;
    text-align: center;
  }

  .xfade-curve-select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    cursor: pointer;
  }

  .xfade-fader-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px;
  }
  .xfade-end-label {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted, #888);
    min-width: 16px;
    text-align: center;
    transition: color 0.15s, text-shadow 0.15s;
  }
  .xfade-end-label.peaked.xfade-end-a { color: #FF8577; text-shadow: 0 0 8px rgba(255, 133, 119, 0.7); }
  .xfade-end-label.peaked.xfade-end-b { color: #7EC8E3; text-shadow: 0 0 8px rgba(126, 200, 227, 0.7); }

  .xfade-fader {
    flex: 1;
    height: 28px;
    -webkit-appearance: none;
    appearance: none;
    background: linear-gradient(90deg, rgba(255, 133, 119, 0.45), rgba(140, 100, 175, 0.35), rgba(126, 200, 227, 0.45));
    border-radius: 14px;
    outline: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
  }
  .xfade-fader::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 32px;
    background: linear-gradient(180deg, #fff, #ddd);
    border: 2px solid #333;
    border-radius: 4px;
    cursor: grab;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 255, 255, 0.3);
    margin-top: -2px;
  }
  .xfade-fader::-webkit-slider-thumb:active { cursor: grabbing; }
  .xfade-fader::-moz-range-thumb {
    width: 22px;
    height: 32px;
    background: linear-gradient(180deg, #fff, #ddd);
    border: 2px solid #333;
    border-radius: 4px;
    cursor: grab;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 255, 255, 0.3);
  }

  /* Column header tinting when crossfader is on */
  .column-trigger.bank-a {
    background: linear-gradient(180deg, rgba(255, 133, 119, 0.12), transparent);
    border-bottom: 2px solid rgba(255, 133, 119, 0.5);
  }
  .column-trigger.bank-b {
    background: linear-gradient(180deg, rgba(126, 200, 227, 0.12), transparent);
    border-bottom: 2px solid rgba(126, 200, 227, 0.5);
  }
  .column-trigger.bank-divider {
    border-left: 2px solid rgba(255, 255, 255, 0.18);
  }

  /* Cell tinting per bank */
  .clip-cell.cell-bank-a { box-shadow: inset 2px 0 0 rgba(255, 133, 119, 0.18); }
  .clip-cell.cell-bank-b { box-shadow: inset -2px 0 0 rgba(126, 200, 227, 0.18); }
  .clip-cell.cell-bank-divider { border-left: 2px solid rgba(255, 255, 255, 0.18); }
  .clip-cell.cell-bank-dimmed { opacity: 0.45; }

  /* Per-row bank routing pill */
  .bank-pill {
    display: inline-flex;
    margin-left: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.25);
  }
  .bank-pill-seg {
    background: transparent;
    border: none;
    color: var(--text-muted, #888);
    font-size: 10px;
    font-weight: 700;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    padding: 3px 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    letter-spacing: 0.05em;
  }
  .bank-pill-seg:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .bank-pill-seg.active {
    background: linear-gradient(135deg, rgba(255, 133, 119, 0.3), rgba(126, 200, 227, 0.3));
    color: #fff;
  }
  .bank-pill-seg + .bank-pill-seg { border-left: 1px solid rgba(255, 255, 255, 0.1); }

  /* ─── VJ Video Controls Panel — mirrors LayerPanel mapping-mode video ─── */
  .video-controls-panel {
    margin: 0;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .vt-transport {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }
  .vt-btn {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #ccc);
    border: none;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .vt-btn:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
  .vt-play {
    background: var(--accent-primary, #BB86FC);
    color: #111;
  }
  .vt-play:hover { background: #CF6EFF; color: #000; }
  .vt-time {
    font-size: 12px;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    margin-left: 4px;
    flex: 1;
    white-space: nowrap;
  }
  .vt-speed {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary, #aaa);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    font-size: 12px;
    padding: 2px 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .vt-speed:hover { border-color: rgba(255, 255, 255, 0.25); }

  .vt-timeline {
    position: relative;
    height: 24px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    cursor: pointer;
    margin-bottom: 8px;
    overflow: visible;
    user-select: none;
  }
  .vt-trim-outside-left,
  .vt-trim-outside-right {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
    z-index: 1;
  }
  .vt-trim-outside-left { left: 0; border-radius: 3px 0 0 3px; }
  .vt-trim-outside-right { right: 0; border-radius: 0 3px 3px 0; }
  .vt-trim-region {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(187, 134, 252, 0.15);
    border-top: 2px solid rgba(187, 134, 252, 0.35);
    border-bottom: 2px solid rgba(187, 134, 252, 0.35);
    pointer-events: none;
    z-index: 1;
  }
  .vt-playhead {
    position: absolute;
    top: -2px;
    width: 2px;
    height: calc(100% + 4px);
    background: var(--accent-primary, #BB86FC);
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.6);
    z-index: 3;
    pointer-events: none;
    transform: translateX(-1px);
  }
  .vt-trim-handle {
    position: absolute;
    top: 0;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    z-index: 4;
    transform: translateX(-4px);
    border-radius: 2px;
    transition: background 0.1s;
  }
  .vt-trim-handle::after {
    content: '';
    position: absolute;
    top: 25%;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 50%;
    background: rgba(187, 134, 252, 0.7);
    border-radius: 1px;
  }
  .vt-trim-handle:hover { background: rgba(187, 134, 252, 0.25); }
  .vt-trim-handle:hover::after { background: var(--accent-primary, #BB86FC); }

  .vt-modes {
    display: flex;
    gap: 2px;
  }

  /* Per-clip transform section — sits below the trim/playback row.
     Compact rows with label + range + numeric readout. */
  .vt-transform {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .vt-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #777;
    margin-bottom: 2px;
  }
  .vt-tf-row {
    display: grid;
    grid-template-columns: 56px 1fr 44px;
    align-items: center;
    gap: 8px;
  }
  .vt-tf-label {
    font-size: 11px;
    color: var(--text-secondary, #aaa);
  }
  .vt-tf-num {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: #6df;
    text-align: right;
  }
  .vt-tf-row input[type="range"] {
    width: 100%;
    accent-color: #6df;
  }
  .vt-tf-select {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ddd);
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    width: 100%;
  }
  .vt-tf-row:has(.vt-tf-select) {
    grid-template-columns: 56px 1fr;
  }
  .vt-tf-toggle-row {
    grid-template-columns: 56px 1fr;
  }
  .vt-toggle-btn {
    width: 100%;
    height: 24px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .vt-toggle-btn.active {
    border-color: rgba(109, 240, 255, 0.45);
    background: rgba(109, 240, 255, 0.16);
    color: #6df;
  }
  /* Audio opt-in block. Amber accent rather than the panel's cyan so the
     one control that makes noise reads as distinct from the visual params. */
  .vt-audio .vt-toggle-btn.active {
    border-color: rgba(251, 191, 36, 0.45);
    background: rgba(251, 191, 36, 0.16);
    color: #fbbf24;
  }
  .vt-audio input[type="range"] {
    accent-color: #fbbf24;
  }
  .vt-audio .vt-tf-num {
    color: #fbbf24;
  }
  .vt-audio-note {
    font-size: 10px;
    color: var(--text-muted, #888);
    font-style: italic;
  }
  .vt-tf-reset {
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-secondary, #aaa);
    padding: 5px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }
  .vt-tf-reset:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .vt-mode-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-muted, #888);
    font-size: 11px;
    padding: 4px 2px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .vt-mode-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #bbb;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .vt-mode-btn.active {
    background: rgba(187, 134, 252, 0.2);
    color: var(--accent-primary, #BB86FC);
    border-color: rgba(187, 134, 252, 0.4);
  }
</style>
