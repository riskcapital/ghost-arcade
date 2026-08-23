import { writable, derived, get } from 'svelte/store';
import type { Layer, Project, WarpCorners, Point2D, BezierPoint, MaskShape, MediaSource, BlendMode, WarpMode, Effect, EffectType, EffectParams, LayerType, SVGContent, SVGFillMode, SVGColorMode, ColorContent, LightPaintingContent, LightPaintingStroke, CropRegion, LayerShape, LayerShapeType, Composition, VJModeState, VJDeck, Timeline, TimelineClip, TextContent, TextAnimation, SplatContent, Model3DContent, MediaTrayFolder, StagePreset, SVKeyboardPreset, EdgeEffect, EdgeEffectsConfig, PixelFXContent, GPULayerContent, AutoConfig, WLEDController, WLEDEffect, WLEDEffectAutomation, WLEDGroup, StageEffect, SurfaceEffectAutomation, MappingCompositionState } from '../types';
import { createLayer, createProject, createDefaultCorners, createMeshGrid, createLinesLayer, createSVGLayer, createColorLayer, createLightPaintingLayer, createAdvLightPaintingLayer, createTextLayer, createSplatLayer, createDefaultSVGContent, createDefaultCropRegion, createDefaultLayerShape, createDefaultVJModeState, createDefaultMappingCompositionState, createDefaultTimeline, generateUUID, createDefaultModel3DContent, createDefaultEdgeEffect, convertShapeToCustom, createGroupLayer, createDefaultPixelFXContent, createDefaultGPULayerContent } from '../types';
import type { GroupConfig } from '../types';
import { mediaLibrary } from './media';
import { vjClipLauncher, type VJClip, type VJBlock, type VJLayerState, DEFAULT_VJ_LAYERS, DEFAULT_VJ_COLUMNS } from './vjClipLauncher';
import { disposeJSAnimationContext } from '../renderer/js-animation';
import { synthVisionStore } from './synthVision';
import { modulationStore, type ParamModulation } from '../audio/modulation';
import { audioStore } from './audio';
import { keyframeTimeline } from './keyframeTimeline';
import { macros } from './macros';
import { snapshots } from './snapshots';
import { layerSequencer } from './layerSequencer';
import { surfaceStore } from './surface';
import {
  captureStagePresetSurfaceState,
  cloneStagePresetSurface,
  resolveStagePresetSurfaceId,
} from './stagePresetSurfaces';
import { stage3dScene } from '../stage3d/store';
import { projectionSimScene } from '../projectionSim/store';
import { showTimeline, setShowCompositionLoader } from './showTimeline';
// Catalog of per-effect default params. Used by resetEffectParams to
// snap an effect back to its baseline values when the user hits the
// per-effect reset button in LayerPanel.
import { getDefaultEffectParams } from '../renderer/effects';
import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
import { oscStore } from '../osc/oscStore';
import { keyboardStore } from '../keyboard/keyboardStore';
import { mediaPipeBus } from '../mediapipe/mediaPipeBus';
import { geoDeckStore } from './geoDeck';
import { createDefaultShapeMesh } from '../drawing/types';
import type { LineElement, LineShape, LinesContent, LineDrawAnimation, LineStroke } from '../lines/types';
import { maxLayers } from './license';
import { NATIVE_ENGINE_ONLY, settings, migrateOutputSlice } from './settings';
import { createLineElement, createDefaultLinesContent, createDefaultDrawAnimation } from '../lines/types';
import { syncTrimmedVideoPlayback } from '../utils/videoTrimPlayback';
import { recoverVJClipAssetRef } from '../storage/vjAssetPersistence';
import { restoreVideoSourceElement } from '../media/videoSourceRestore';
import { clipAudioBus, type ClipAudioTransport } from '../audio/clipAudioBus';

// History recording callback — set from App.svelte to avoid circular imports.
// We record SYNCHRONOUSLY (no setTimeout) so each discrete action lands in its
// own undo step. Previously this used setTimeout(_, 0) which coalesced rapid
// successive actions — drawing 10 light-painting strokes in quick succession
// scheduled 10 callbacks that all fired in the next tick reading the SAME
// post-mutation project, so the undo stack only got 1 entry pointing at the
// pre-first-stroke state. One undo would wipe every stroke. Now each call
// captures the project state synchronously, post-update, so undo unwinds
// stroke-by-stroke as expected.
let _onDiscreteAction: (() => void) | null = null;
export function setHistoryCallback(fn: () => void) { _onDiscreteAction = fn; }
function recordDiscreteAction() { if (_onDiscreteAction) _onDiscreteAction(); }
const selectedLayerIdsState = writable<string[]>([]);

function cleanMediaSourceName(source: MediaSource): string {
  return (source.name || '').replace(/\.[^.]+$/, '').trim() || source.name || 'Media';
}

function shouldAutoRenameMediaLayer(layer: Layer, source: MediaSource | null): source is MediaSource {
  if (!source || (source.type !== 'image' && source.type !== 'video')) return false;
  const currentName = (layer.name || '').trim();
  if (!currentName) return true;
  return /^(media|media layer|image|video|new layer|layer \d+)$/i.test(currentName);
}

function isVideoSource(source: MediaSource | null | undefined): source is MediaSource {
  return !!source && source.type === 'video' && !!source.src;
}

function rehydrateVideoSource(source: MediaSource) {
  if (typeof document === 'undefined' || source.videoElement || !isVideoSource(source)) return;
  restoreVideoSourceElement(source);
}

function normalizeSelectedLayerIds(layerIds: string[], validIds: string[]): string[] {
  const validSet = new Set(validIds);
  const deduped: string[] = [];
  for (const id of layerIds) {
    if (!validSet.has(id) || deduped.includes(id)) continue;
    deduped.push(id);
  }
  return deduped;
}

function normalizeMediaTrayFolders(folders: MediaTrayFolder[] | undefined): MediaTrayFolder[] {
  if (!Array.isArray(folders)) return [];
  return folders
    .filter((folder) => folder && (folder.tab === 'videos' || folder.tab === 'images' || folder.tab === 'shaders'))
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      tab: folder.tab,
      itemIds: Array.from(new Set(folder.itemIds || [])),
    }));
}

function normalizeMappingCompositionState(input: unknown): MappingCompositionState {
  const base = createDefaultMappingCompositionState();
  const raw = input && typeof input === 'object' ? input as Partial<MappingCompositionState> : {};
  const auto = raw.stageEffectAutomation || base.stageEffectAutomation;
  return {
    enabled: !!raw.enabled,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    stageEffects: Array.isArray(raw.stageEffects) ? raw.stageEffects : [],
    activeStageEffectId: raw.activeStageEffectId ?? null,
    stageEffectAutomation: {
      playing: !!auto.playing,
      mode: auto.mode === 'beat' ? 'beat' : 'time',
      seconds: typeof auto.seconds === 'number' ? Math.max(0.1, auto.seconds) : base.stageEffectAutomation.seconds,
      beats: typeof auto.beats === 'number' ? Math.max(1, Math.round(auto.beats)) : base.stageEffectAutomation.beats,
    },
  };
}

function cloneStagePresetLayers(layers: Layer[], action: string): Layer[] {
  const snapshot: Layer[] = [];
  for (const layer of layers) {
    try {
      const cleanLayer = JSON.parse(JSON.stringify(layer, (key, value) => {
        if (key === 'texture' || key === 'videoElement') return undefined;
        if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) {
          return undefined;
        }
        return value;
      }));
      snapshot.push(cleanLayer);
    } catch (err) {
      console.warn(`[Store] Failed to clone layer for stage preset ${action}:`, layer.id, err);
    }
  }
  return snapshot;
}

function captureStagePresetSnapshot(
  currentProject: Project,
  name: string,
  thumbnail?: string,
  scope: 'project' | 'global' = 'project',
  id: string = generateUUID(),
): StagePreset {
  let surfaceId: string | undefined;
  let surfaceSnapshot: StagePreset['surfaceSnapshot'];
  let stageEffects: StagePreset['stageEffects'];
  try {
    const surfaceState = get(surfaceStore);
    const activeSurface = surfaceState.surfaces.find(
      surface => surface.id === surfaceState.activeSurfaceId
    );
    if (activeSurface) {
      const captured = captureStagePresetSurfaceState(activeSurface);
      surfaceId = captured.surfaceId;
      surfaceSnapshot = captured.surfaceSnapshot;
      stageEffects = captured.stageEffects;
    }
  } catch (err) {
    console.warn('[Store] Stage preset surface snapshot failed', err);
  }

  let stage3d: unknown;
  try {
    stage3d = JSON.parse(JSON.stringify(get(stage3dScene)));
  } catch (err) {
    console.warn('[Store] Stage preset 3D scene snapshot failed', err);
  }

  return {
    id,
    name,
    thumbnail,
    createdAt: Date.now(),
    layers: cloneStagePresetLayers(currentProject.layers, 'capture'),
    scope,
    surfaceId,
    surfaceSnapshot,
    stageEffects,
    stage3d,
  };
}

// ── Utility: convert a session-only blob URL to a persistable data URL ──
async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[blobUrlToDataUrl] Failed to convert blob URL to data URL:', err);
    return null;
  }
}

/** Insert a new layer at the position the user has chosen in Settings →
 *  Project → New Layer Placement. Falls back to "top" if active-layer
 *  variants are selected but nothing is currently selected. Single
 *  source of truth — every addXxxLayer() helper below uses this. */
function placeNewLayer(layers: Layer[], newLayer: Layer, selectedLayerId: string | null): Layer[] {
  const placement = get(settings).newLayerPlacement ?? 'top';
  switch (placement) {
    case 'bottom':
      return [...layers, newLayer];
    case 'aboveActive': {
      const i = selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : -1;
      if (i < 0) return [newLayer, ...layers];
      return [...layers.slice(0, i), newLayer, ...layers.slice(i)];
    }
    case 'belowActive': {
      const i = selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : -1;
      if (i < 0) return [...layers, newLayer];
      return [...layers.slice(0, i + 1), newLayer, ...layers.slice(i + 1)];
    }
    case 'top':
    default:
      return [newLayer, ...layers];
  }
}

const NATIVE_READY_LAYER_TYPES = new Set<LayerType>(['media', 'gpu', 'color', 'lines', 'svg', 'lightpainting', 'text', 'splat', 'model3d', 'group', 'screen', 'mask']);

function nativeLayerTypePending(type: LayerType): boolean {
  return NATIVE_ENGINE_ONLY && Boolean(get(settings).experimental?.outputNativeCore) && !NATIVE_READY_LAYER_TYPES.has(type);
}

function blockNativePendingLayerType(type: LayerType): boolean {
  if (!nativeLayerTypePending(type)) return false;
  console.warn(`[layers] blocked non-native layer type in native-only mode: ${type}`);
  return true;
}

function blockNativePendingInitialShape(type: LayerType, initialShapeType?: LayerShapeType): boolean {
  if (!NATIVE_ENGINE_ONLY || !get(settings).experimental?.outputNativeCore) return false;
  if (type !== 'media' || !initialShapeType) return false;
  // The native compositor renders every shape type except line/polyline.
  if (initialShapeType !== 'line' && initialShapeType !== 'polyline') {
    return false;
  }
  console.warn(`[layers] blocked non-native initial media shape in native-only mode: ${initialShapeType}`);
  return true;
}

// Main project store
function createProjectStore() {
  const { subscribe, set, update } = writable<Project>(createProject('Untitled Project'));

  // Built-in inline shaders for default layer source
  const BUILTIN_SHADERS: Record<string, { name: string; code: string }> = {
    crosshair: {
      name: 'CenterCrosshair',
      code: '', // Loaded from file: ./ISF/DM-CenterCrosshair.fs
    },
    grid: {
      name: 'SimpleGrid',
      code: `/*{"DESCRIPTION":"Simple grid with edge outline","INPUTS":[{"NAME":"gridSize","TYPE":"float","DEFAULT":20.0,"MIN":4.0,"MAX":100.0},{"NAME":"lineWidth","TYPE":"float","DEFAULT":0.02,"MIN":0.005,"MAX":0.1},{"NAME":"gridColor","TYPE":"color","DEFAULT":[0.3,0.3,0.3,1.0]},{"NAME":"bgColor","TYPE":"color","DEFAULT":[0.05,0.05,0.05,1.0]}]}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  // Aspect-correct line width so lines are uniform pixels on both axes
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float lwX = lineWidth;
  float lwY = lineWidth * aspect;
  vec2 grid = fract(uv * gridSize);
  float line = step(grid.x, lwX) + step(grid.y, lwY);
  line = clamp(line, 0.0, 1.0);
  // Edge outline: thin crisp border, aspect-corrected
  float ewX = lwX * 0.4;
  float ewY = lwY * 0.4;
  float edge = step(uv.x, ewX) + step(1.0 - ewX, uv.x) + step(uv.y, ewY) + step(1.0 - ewY, uv.y);
  edge = clamp(edge, 0.0, 1.0);
  vec3 col = mix(bgColor.rgb, gridColor.rgb, line);
  col = mix(col, gridColor.rgb * 1.8, edge);
  gl_FragColor = vec4(col, 1.0);
}`,
    },
    outline: {
      name: 'BlueOutline',
      code: `/*{"DESCRIPTION":"Blue outline border","INPUTS":[{"NAME":"thickness","TYPE":"float","DEFAULT":0.015,"MIN":0.005,"MAX":0.05},{"NAME":"outlineColor","TYPE":"color","DEFAULT":[0.2,0.5,1.0,1.0]}]}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  float border = step(uv.x, thickness) + step(1.0 - thickness, uv.x) + step(uv.y, thickness) + step(1.0 - thickness, uv.y);
  border = clamp(border, 0.0, 1.0);
  // Crosshair center lines
  float cx = smoothstep(0.002, 0.0, abs(uv.x - 0.5));
  float cy = smoothstep(0.002, 0.0, abs(uv.y - 0.5));
  float cross = max(cx, cy) * 0.4;
  gl_FragColor = vec4(outlineColor.rgb, max(border, cross));
}`,
    },
    testpattern: {
      name: 'TestPattern',
      code: `/*{"DESCRIPTION":"Color bars test pattern","INPUTS":[]}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  int bar = int(uv.x * 8.0);
  vec3 colors[8];
  colors[0] = vec3(0.75);
  colors[1] = vec3(0.75, 0.75, 0.0);
  colors[2] = vec3(0.0, 0.75, 0.75);
  colors[3] = vec3(0.0, 0.75, 0.0);
  colors[4] = vec3(0.75, 0.0, 0.75);
  colors[5] = vec3(0.75, 0.0, 0.0);
  colors[6] = vec3(0.0, 0.0, 0.75);
  colors[7] = vec3(0.0);
  vec3 c = colors[0];
  if (bar == 1) c = colors[1];
  else if (bar == 2) c = colors[2];
  else if (bar == 3) c = colors[3];
  else if (bar == 4) c = colors[4];
  else if (bar == 5) c = colors[5];
  else if (bar == 6) c = colors[6];
  else if (bar == 7) c = colors[7];
  gl_FragColor = vec4(c, 1.0);
}`,
    },
  };

  // Auto-apply default shader to a newly created layer (fire-and-forget)
  const autoApplyDefaultShader = (layerId: string) => {
    (async () => {
      try {
        // Get the user's preferred default shader from settings
        const { settings: settingsStore } = await import('./settings');
        const appSettings = get(settingsStore);
        const shaderChoice = appSettings.defaultLayerShader || 'grid';

        // 'none' = blank layer, no shader
        if (shaderChoice === 'none') return;

        let shaderCode: string;
        let name: string;

        if (shaderChoice === 'crosshair') {
          // Load from ISF file (existing behavior)
          const res = await fetch('./ISF/DM-CenterCrosshair.fs');
          if (!res.ok) return;
          shaderCode = await res.text();
          name = 'CenterCrosshair';
        } else {
          const builtin = BUILTIN_SHADERS[shaderChoice];
          if (!builtin) return;
          shaderCode = builtin.code;
          name = builtin.name;
        }

        const headerMatch = shaderCode.match(/\/\*\{([\s\S]*?)\}\*\//);
        const isfMeta = headerMatch ? JSON.parse(`{${headerMatch[1]}}`) : { INPUTS: [] };
        const inputs = isfMeta.INPUTS || [];
        const shaderValues: Record<string, number | boolean | number[]> = {};
        for (const input of inputs) {
          if (input.DEFAULT !== undefined) {
            shaderValues[input.NAME] = input.DEFAULT;
          }
        }

        // Guard: only apply if layer still has no source
        const currentProject = get({ subscribe });
        const layer = currentProject.layers.find(l => l.id === layerId);
        if (!layer || layer.source) return;

        const source: MediaSource = {
          id: `default-${layerId}-${Date.now()}`,
          type: 'shader',
          src: shaderChoice === 'crosshair' ? './ISF/DM-CenterCrosshair.fs' : `builtin:${shaderChoice}`,
          name,
          shaderCode,
          shaderInputs: inputs,
          shaderValues,
          shaderImageInputs: {},
        };
        store.setLayerSource(layerId, source);
      } catch {
        // Silently fail
      }
    })();
  };

  const restoreStagePresetSnapshot = (preset: StagePreset) => {
    const effectsSnapshot = preset.stageEffects;
    const stage3dSnapshot = preset.stage3d as any;
    const surfaceSnapshot = preset.surfaceSnapshot
      ? cloneStagePresetSurface(preset.surfaceSnapshot)
      : undefined;
    const surfaceState = get(surfaceStore);
    const surfaceId = resolveStagePresetSurfaceId(
      preset,
      surfaceState.surfaces,
      surfaceState.activeSurfaceId,
    );

    update(currentProject => ({
      ...currentProject,
      layers: structuredClone(preset.layers),
    }));
    vjClipLauncher.setStagePreset(preset.id);

    if (surfaceSnapshot) {
      surfaceStore.restorePresetSurface(surfaceSnapshot);
    } else if (surfaceId) {
      surfaceStore.setActiveSurface(surfaceId);
    }
    if (effectsSnapshot) {
      surfaceStore.setStageEffectsBundle({
        effects: effectsSnapshot.effects ?? [],
        activeEffectId: effectsSnapshot.activeEffectId ?? null,
        automation: effectsSnapshot.automation ?? null,
      });
    }

    if (stage3dSnapshot?.schemaVersion === 1 && Array.isArray(stage3dSnapshot?.nodes)) {
      queueMicrotask(() => {
        try {
          stage3dScene.loadScene(stage3dSnapshot);
        } catch (err) {
          console.warn('[Store] loadStagePreset: 3D scene restore failed', err);
        }
      });
    }
  };

  const store = {
    subscribe,
    set,
    update,

    // Layer management
    addLayer(name?: string, type: LayerType = 'media', initialShapeType?: LayerShapeType): string | undefined {
      if (blockNativePendingLayerType(type)) return undefined;
      if (blockNativePendingInitialShape(type, initialShapeType)) return undefined;
      const currentProject = get({ subscribe });
      const limit = get(maxLayers);
      if (currentProject.layers.length >= limit) {
        console.warn(`[License] Layer limit reached (${limit}). Upgrade to add more layers.`);
        // Dispatch a custom event so the UI can show an upgrade prompt
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('license-layer-limit', { detail: { limit } }));
        }
        return undefined;
      }
      const id = generateUUID();
      update((project) => {
        const layerName = name || (
          type === 'lines'
            ? `Lines ${project.layers.filter(l => l.type === 'lines').length + 1}`
            : type === 'mask'
              ? `Mask ${project.layers.filter(l => l.type === 'mask').length + 1}`
              : `Layer ${project.layers.filter(l => l.type === 'media').length + 1}`
        );
        const newLayer = createLayer(id, layerName, type);
        if (type === 'media' && initialShapeType) {
          newLayer.layerShape = createDefaultLayerShape(initialShapeType);
        }
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();

      // Auto-apply crosshair shader to media layers so the user can see placement
      if (type === 'media' && !(NATIVE_ENGINE_ONLY && Boolean(get(settings).experimental?.outputNativeCore))) {
        autoApplyDefaultShader(id);
      }
      return id;
    },

    addLinesLayer(name?: string) {
      if (blockNativePendingLayerType('lines')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Lines ${project.layers.filter(l => l.type === 'lines').length + 1}`;
        const newLayer = createLinesLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addSVGLayer(name?: string) {
      if (blockNativePendingLayerType('svg')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `SVG ${project.layers.filter(l => l.type === 'svg').length + 1}`;
        const newLayer = createSVGLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addColorLayer(name?: string) {
      if (blockNativePendingLayerType('color')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Color ${project.layers.filter(l => l.type === 'color').length + 1}`;
        const newLayer = createColorLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    /** Batch-create mapping layers from a Stage Designer Surface's
     *  slices. Each slice becomes a custom-shape media layer:
     *
     *  - corners: the slice polygon's surface-space bbox, expressed in
     *    project-normalized 0..1 coords (Y-flipped — corners use the
     *    UV convention where Y=1 is top, Y=0 is bottom; surface coords
     *    are SVG-style Y-down).
     *  - layerShape.type='custom' with the slice's bezier polygon
     *    transformed into layer-local 0..1 space + Y-flipped. The
     *    engine's existing custom-shape rendering path (polygon mask
     *    shader + bezier tessellation in tessellateMaskShape) clips
     *    content to the polygon — content fills the bbox, mask makes
     *    only the polygon visible.
     *  - corner-warp on the new layer is set to the bbox so dragging
     *    a corner re-anchors the polygon to a physical surface point.
     *
     *  If `replaceLinked` is true and the caller passes a sliceId →
     *  layerId map, EXISTING linked layers are updated in place rather
     *  than duplicated — re-applying a stage doesn't pile up layers
     *  across multiple rounds.
     *
     *  Returns a fresh sliceId → layerId map. */
    applyStageSurfaceToLayers(
      surface: import('../types').Surface,
      existingLinks?: Record<string, string>,
    ): Record<string, string> {
      const links: Record<string, string> = {};
      // Tracks layer ids freshly created in this pass — used after the
      // update() to auto-apply the default shader (which itself runs
      // through async settings loading + project.update, so it must
      // happen OUTSIDE the current update() to avoid nested mutation).
      const freshIds: string[] = [];
      update((project) => {
        let layers = project.layers;
        const sw = Math.max(1, surface.width);
        const sh = Math.max(1, surface.height);
        for (const slice of surface.slices) {
          if (slice.polygon.length < 3) continue;
          // 1. Compute slice bbox in surface coords (using anchors —
          //    bezier handles slightly extend beyond but the warp can
          //    be adjusted after import and most real-world projection
          //    geometry has anchors at the extremes).
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of slice.polygon) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          }
          const bw = Math.max(1e-6, maxX - minX);
          const bh = Math.max(1e-6, maxY - minY);
          // 2. Re-normalize polygon to layer-local 0..1 + Y-flip
          //    (surface Y is down, layer UV Y is up).
          const localPoly = slice.polygon.map(p => ({
            x: (p.x - minX) / bw,
            y: 1 - (p.y - minY) / bh,
            cpIn:  p.cpIn  ? { x: (p.cpIn.x  - minX) / bw, y: 1 - (p.cpIn.y  - minY) / bh } : undefined,
            cpOut: p.cpOut ? { x: (p.cpOut.x - minX) / bw, y: 1 - (p.cpOut.y - minY) / bh } : undefined,
          }));
          // 3. corners in project-normalized 0..1, SAME Y-down convention
          //    as the canvas/engine (y=0 top). Previously these were
          //    Y-flipped ("UV convention") — but the engine renders and
          //    unified-crops corners as Y-down (verified empirically:
          //    a quad with corner y .85-.95 displays at the BOTTOM of
          //    the canvas), so flipped corners made every Apply-Stage
          //    layout render vertically mirrored. Symmetric layouts hid
          //    the placement mirror, but unified-group screens sampled
          //    the mirrored band of the shared texture — the "VJ stage
          //    bands are reversed vs 3D stage" bug.
          const cMinX = minX / sw, cMaxX = maxX / sw;
          const cTop  = minY / sh;
          const cBot  = maxY / sh;
          const corners = {
            topLeft:     { x: cMinX, y: cTop },
            topRight:    { x: cMaxX, y: cTop },
            bottomLeft:  { x: cMinX, y: cBot },
            bottomRight: { x: cMaxX, y: cBot },
          };

          const existingId = existingLinks?.[slice.id];
          if (existingId && layers.some(l => l.id === existingId)) {
            // Update in place — preserves any content the user has
            // already assigned to this layer between applies.
            layers = layers.map(l => l.id === existingId ? {
              ...l,
              name: slice.name,
              corners,
              stageTextureFlipV: true,
              layerShape: {
                type: 'custom' as const,
                enabled: true,
                params: {
                  ...(l.layerShape?.params ?? { feather: 0, rotation: 0 }),
                  customPoints: localPoly,
                  customBasePoints: localPoly.map((point) => ({ ...point })),
                  customClosed: true,
                },
              },
            } : l);
            links[slice.id] = existingId;
          } else {
            // Fresh Screen (VJ Output) layer with custom shape pre-
            // applied. Screen layers are the type that participates in
            // VJ stage mode — vjLayerIndex tells the engine which VJ
            // clip stream to route through this layer's mapping. They
            // also group naturally with project.createGroupFromIds so
            // users can group slice-layers and save the bundle as a
            // mapping preset.
            const id = generateUUID();
            const fresh: Layer = {
              ...createLayer(id, slice.name, 'screen'),
              vjLayerIndex: 0,
              stageTextureFlipV: true,
            };
            fresh.corners = corners;
            fresh.layerShape = {
              type: 'custom',
              enabled: true,
              params: {
                feather: 0,
                rotation: 0,
                customPoints: localPoly,
                customBasePoints: localPoly.map((point) => ({ ...point })),
                customClosed: true,
              },
            };
            layers = [fresh, ...layers];
            links[slice.id] = id;
            freshIds.push(id);
          }
        }
        return { ...project, layers, selectedLayerId: layers[0]?.id ?? null };
      });
      recordDiscreteAction();
      // Auto-apply the user's default layer shader to each freshly-
      // created Screen layer so empty slices have a visible reference
      // (crosshair / grid / whatever the user has configured) instead
      // of being blank until content is dropped in. Matches the
      // addScreenLayer behavior — same code path.
      for (const id of freshIds) autoApplyDefaultShader(id);
      return links;
    },

    addLightPaintingLayer(name?: string) {
      if (blockNativePendingLayerType('lightpainting')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Light Paint ${project.layers.filter(l => l.type === 'lightpainting').length + 1}`;
        const newLayer = createLightPaintingLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    /** Add an Adv Light Painting layer (WebGPU 3D particle paint).
     *  Renders only when experimental.editorWebGPU is on (the WebGPU
     *  bridge owns the compute + render pipeline). With the flag off
     *  the layer is visible in the layer panel but renders nothing —
     *  intentional, so the project file stays portable across the
     *  flag flip. */
    addAdvLightPaintingLayer(name?: string) {
      if (blockNativePendingLayerType('adv-lightpaint')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Adv Light Paint ${project.layers.filter(l => l.type === 'adv-lightpaint').length + 1}`;
        const newLayer = createAdvLightPaintingLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    // Text layer methods
    addTextLayer(name?: string) {
      if (blockNativePendingLayerType('text')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Text ${project.layers.filter(l => l.type === 'text').length + 1}`;
        const newLayer = createTextLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    // Splat layer methods (Point Cloud / Gaussian Splat)
    addSplatLayer(name?: string) {
      if (blockNativePendingLayerType('splat')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Splat ${project.layers.filter(l => l.type === 'splat').length + 1}`;
        const newLayer = createSplatLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    updateSplatContent(layerId: string, updates: Partial<SplatContent>) {
      // Sync aliased properties - keep UI and renderer properties in sync
      const syncedUpdates = { ...updates } as Record<string, unknown>;

      // Color effects
      if ('colorEffect' in syncedUpdates) {
        syncedUpdates.colorEffectType = syncedUpdates.colorEffect;
      }
      if ('colorEffectType' in syncedUpdates) {
        syncedUpdates.colorEffect = syncedUpdates.colorEffectType;
      }

      // Opacity effects
      if ('opacityEffect' in syncedUpdates) {
        syncedUpdates.opacityEffectType = syncedUpdates.opacityEffect;
      }
      if ('opacityEffectType' in syncedUpdates) {
        syncedUpdates.opacityEffect = syncedUpdates.opacityEffectType;
      }

      // Creative effects
      if ('creativeEffect' in syncedUpdates) {
        syncedUpdates.creativeEffectType = syncedUpdates.creativeEffect;
      }
      if ('creativeEffectType' in syncedUpdates) {
        syncedUpdates.creativeEffect = syncedUpdates.creativeEffectType;
      }

      // Size attenuation
      if ('sizeAttenuation' in syncedUpdates) {
        syncedUpdates.pointSizeAttenuation = syncedUpdates.sizeAttenuation;
      }
      if ('pointSizeAttenuation' in syncedUpdates) {
        syncedUpdates.sizeAttenuation = syncedUpdates.pointSizeAttenuation;
      }

      // Mouse interaction - sync mouseInteraction to mouseMode
      if ('mouseInteraction' in syncedUpdates) {
        const modeMap: Record<string, string> = {
          'none': 'attract', // Default to attract when none
          'attract': 'attract',
          'repel': 'repel',
          'swirl': 'swirl',
          'reveal': 'reveal'
        };
        syncedUpdates.mouseMode = modeMap[syncedUpdates.mouseInteraction as string] || 'attract';
        // Set mouseInfluence to 0 when 'none', otherwise enable it with good defaults
        if (syncedUpdates.mouseInteraction === 'none') {
          syncedUpdates.mouseInfluence = 0;
        } else {
          // When enabling mouse interaction, set a good default strength
          syncedUpdates.mouseInfluence = 1.0;
          syncedUpdates.mouseStrength = 1.0;
          // Set a reasonable default radius if not already set high
          if (!syncedUpdates.mouseRadius || (syncedUpdates.mouseRadius as number) < 0.2) {
            syncedUpdates.mouseRadius = 0.3;
          }
        }
      }

      // Sync mouseStrength to mouseInfluence
      if ('mouseStrength' in syncedUpdates) {
        syncedUpdates.mouseInfluence = syncedUpdates.mouseStrength;
      }

      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.splatContent) {
            return layer;
          }

          // Build the updated content
          const updatedContent = { ...layer.splatContent, ...syncedUpdates };

          // Sync flat physics properties to nested physics object
          if ('gravity' in syncedUpdates || 'friction' in syncedUpdates || 'bounciness' in syncedUpdates) {
            updatedContent.physics = {
              ...layer.splatContent.physics,
              gravity: syncedUpdates.gravity !== undefined ? syncedUpdates.gravity as number : layer.splatContent.physics.gravity,
              // Map friction/bounciness to physics object properties
              damping: syncedUpdates.friction !== undefined ? 1 - (syncedUpdates.friction as number) : layer.splatContent.physics.damping,
              bounce: syncedUpdates.bounciness !== undefined ? syncedUpdates.bounciness as number : layer.splatContent.physics.bounce,
            };
          }

          return { ...layer, splatContent: updatedContent };
        }),
      }));
    },

    setSplatFilePath(layerId: string, filePath: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.splatContent
            ? { ...layer, splatContent: { ...layer.splatContent, filePath } }
            : layer
        ),
      }));
    },

    // 3D Model layer methods
    addModel3DLayer(name?: string) {
      if (blockNativePendingLayerType('model3d')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `3D Model ${project.layers.filter(l => l.type === 'model3d').length + 1}`;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'model3d'),
          model3dContent: createDefaultModel3DContent(),
        };
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    /** Add a Pixel FX layer (WebGPU source-to-particles). User picks
     *  the source via the panel; the layer renders nothing until a
     *  source is set. Default mode is 'depth-shift' so the first
     *  visible result is the source displaced into 3D space — most
     *  immediately demos the WebGPU magic. */
    addPixelFXLayer(name?: string) {
      if (blockNativePendingLayerType('pixel-fx')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Pixel FX ${project.layers.filter(l => l.type === 'pixel-fx').length + 1}`;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'pixel-fx'),
          pixelFXContent: createDefaultPixelFXContent(),
        };
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    /** Add a GPU layer — hosts a swappable WebGPU shader (planet,
     *  particle, etc). The selected shader's defaults are populated
     *  by the renderer on first frame so the new layer starts with
     *  a useful look immediately. */
    addGPULayer(name?: string, shaderId = 'planet') {
      if (blockNativePendingLayerType('gpu')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `GPU ${project.layers.filter(l => l.type === 'gpu').length + 1}`;
        const gpuLayerContent = createDefaultGPULayerContent();
        gpuLayerContent.shaderId = shaderId;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'gpu'),
          gpuLayerContent,
        };
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    /** Patch a gpu layer's content (shader id and/or params).
     *  The renderer reads the layer's content each frame so a single
     *  store update is the whole sync path. */
    updateGPULayerContent(layerId: string, updates: Partial<GPULayerContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.gpuLayerContent
            ? { ...layer, gpuLayerContent: { ...layer.gpuLayerContent, ...updates } }
            : layer
        ),
      }));
    },

    /** Patch the params of a gpu layer (shorthand — merges into
     *  existing params). Used by every slider in the panel. */
    updateGPULayerParams(layerId: string, paramUpdates: Record<string, any>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.gpuLayerContent
            ? { ...layer, gpuLayerContent: { ...layer.gpuLayerContent, params: { ...layer.gpuLayerContent.params, ...paramUpdates } } }
            : layer
        ),
      }));
    },

    addScreenLayer(name?: string) {
      if (blockNativePendingLayerType('screen')) return;
      const id = generateUUID();
      update((project) => {
        const layerName = name || `Screen ${project.layers.filter(l => l.type === 'screen').length + 1}`;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'screen'),
          vjLayerIndex: 0,
        };
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();

      // Auto-apply crosshair shader for alignment reference
      autoApplyDefaultShader(id);
    },

    // ── Group layer methods ────────────────────────────────────────────────

    addGroupLayer(name?: string) {
      if (blockNativePendingLayerType('group')) return;
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Group ${project.layers.filter(l => l.type === 'group').length + 1}`;
        const newLayer = createGroupLayer(id, layerName);
        return {
          ...project,
          layers: placeNewLayer(project.layers, newLayer, project.selectedLayerId),
          selectedLayerId: id,
        };
      });
      selectedLayerIdsState.set([get({ subscribe }).selectedLayerId!]);
      recordDiscreteAction();
    },

    /** Group the supplied layer ids (in their existing project.layers
     *  order) into a new group. Mirrors createGroupFromSelection's
     *  insertion logic but takes the id list explicitly so the caller
     *  doesn't have to round-trip through the selection store —
     *  useful for the right-click "group all" action and for tests. */
    createGroupFromIds(idsToGroup: string[]) {
      console.log('[createGroupFromIds] ids=', idsToGroup);
      const validInputs = idsToGroup.filter((id) => !!id);
      if (validInputs.length < 1) return;
      let resultGroupId: string | null = null;
      update((project) => {
        const groupId = generateUUID();
        const groupName = `Group ${project.layers.filter((l) => l.type === 'group').length + 1}`;
        const groupLayer = createGroupLayer(groupId, groupName);
        resultGroupId = groupId;

        const indices = validInputs
          .map((id) => project.layers.findIndex((l) => l.id === id))
          .filter((i) => i >= 0);
        if (indices.length === 0) {
          console.warn('[createGroupFromIds] no inputs match project.layers', validInputs);
          return project;
        }
        const insertAt = Math.min(...indices);
        const idSet = new Set(validInputs);
        const remaining = project.layers.filter((l) => !idSet.has(l.id));
        const children = project.layers
          .filter((l) => idSet.has(l.id) && l.type !== 'group')
          .map((l) => ({ ...l, parentGroupId: groupId }));
        if (children.length === 0) {
          console.warn('[createGroupFromIds] all inputs are group-type — nothing to wrap', validInputs);
          return project;
        }
        const newLayers = [...remaining];
        newLayers.splice(insertAt, 0, groupLayer, ...children);
        console.log('[createGroupFromIds] created group', { groupId, childCount: children.length, total: newLayers.length });
        return { ...project, layers: newLayers, selectedLayerId: groupId };
      });
      if (resultGroupId) {
        selectedLayerIdsState.set([resultGroupId]);
        recordDiscreteAction();
      }
    },

    /** Create a group from currently selected layers */
    createGroupFromSelection() {
      const selectedIds = get(selectedLayerIdsState);
      console.log('[createGroupFromSelection] selectedIds=', selectedIds);
      if (selectedIds.length < 1) {
        console.warn('[createGroupFromSelection] no layers selected — aborting');
        return;
      }
      let resultGroupId: string | null = null;
      let resultChildIds: string[] = [];
      update((project) => {
        const groupId = generateUUID();
        const groupName = `Group ${project.layers.filter(l => l.type === 'group').length + 1}`;
        const groupLayer = createGroupLayer(groupId, groupName);
        resultGroupId = groupId;

        // Find earliest selected layer position
        const indices = selectedIds
          .map(id => project.layers.findIndex(l => l.id === id))
          .filter(i => i >= 0);
        if (indices.length === 0) {
          console.warn('[createGroupFromSelection] none of the selectedIds match project.layers — aborting', { selectedIds, layerIds: project.layers.map(l => l.id) });
          return project;
        }
        const insertAt = Math.min(...indices);

        // Remove selected from current positions, clear any existing parentGroupId
        const remaining = project.layers.filter(l => !selectedIds.includes(l.id));
        const children = project.layers
          .filter(l => selectedIds.includes(l.id) && l.type !== 'group') // no nested groups
          .map(l => ({ ...l, parentGroupId: groupId }));
        resultChildIds = children.map(c => c.id);
        if (children.length === 0) {
          console.warn('[createGroupFromSelection] all selectedIds are group-type — nothing to wrap; aborting', { selectedIds });
          return project;
        }

        // Insert group + children at the position of the first selected
        const newLayers = [...remaining];
        newLayers.splice(insertAt, 0, groupLayer, ...children);
        console.log('[createGroupFromSelection] created group', { groupId, childCount: children.length, total: newLayers.length });

        return { ...project, layers: newLayers, selectedLayerId: groupId };
      });
      if (resultGroupId) {
        selectedLayerIdsState.set([resultGroupId]);
        recordDiscreteAction();
      }
      void resultChildIds;
    },

    /** Move layers into an existing group */
    addToGroup(layerIds: string[], groupId: string) {
      update((project) => {
        const groupIdx = project.layers.findIndex(l => l.id === groupId);
        if (groupIdx < 0) return project;

        // Filter out group-type layers (no nesting) and already-in-group layers
        const movableIds = layerIds.filter(id => {
          const l = project.layers.find(ll => ll.id === id);
          return l && l.type !== 'group' && l.id !== groupId;
        });
        if (movableIds.length === 0) return project;

        // Find last child of this group to insert after
        let lastChildIdx = groupIdx;
        for (let i = groupIdx + 1; i < project.layers.length; i++) {
          if (project.layers[i].parentGroupId === groupId) lastChildIdx = i;
          else break;
        }

        // Remove from current positions
        const movableSet = new Set(movableIds);
        const without = project.layers.filter(l => !movableSet.has(l.id));
        const moved = project.layers
          .filter(l => movableSet.has(l.id))
          .map(l => ({ ...l, parentGroupId: groupId }));

        // Recalculate insertion point (group's last child + 1 in the 'without' array)
        const newGroupIdx = without.findIndex(l => l.id === groupId);
        let insertAfter = newGroupIdx;
        for (let i = newGroupIdx + 1; i < without.length; i++) {
          if (without[i].parentGroupId === groupId) insertAfter = i;
          else break;
        }

        const newLayers = [...without];
        newLayers.splice(insertAfter + 1, 0, ...moved);
        return { ...project, layers: newLayers };
      });
      recordDiscreteAction();
    },

    /** Remove layers from their parent group (move to top level) */
    removeFromGroup(layerIds: string[]) {
      update((project) => {
        const newLayers = project.layers.map(l =>
          layerIds.includes(l.id) ? { ...l, parentGroupId: null } : l
        );
        return { ...project, layers: newLayers };
      });
      recordDiscreteAction();
    },

    /** Dissolve a group: orphan children, remove group layer */
    dissolveGroup(groupId: string) {
      update((project) => {
        const newLayers = project.layers
          .filter(l => l.id !== groupId)
          .map(l => l.parentGroupId === groupId ? { ...l, parentGroupId: null } : l);
        const nextSelected = project.selectedLayerId === groupId
          ? (newLayers[0]?.id ?? null)
          : project.selectedLayerId;
        return { ...project, layers: newLayers, selectedLayerId: nextSelected };
      });
      recordDiscreteAction();
    },

    toggleGroupCollapse(groupId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map(l =>
          l.id === groupId ? { ...l, groupCollapsed: !l.groupCollapsed } : l
        ),
      }));
    },

    updateGroupConfig(groupId: string, updates: Partial<GroupConfig>) {
      update((project) => ({
        ...project,
        layers: project.layers.map(l =>
          l.id === groupId && l.groupConfig
            ? { ...l, groupConfig: { ...l.groupConfig, ...updates } }
            : l
        ),
      }));
      recordDiscreteAction();
    },

    setLayerVJIndex(id: string, vjLayerIndex: number | undefined) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, vjLayerIndex } : l)),
      }));
      recordDiscreteAction();
    },

    updateModel3DContent(layerId: string, updates: Partial<Model3DContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.model3dContent) {
            return layer;
          }

          // Handle nested object updates
          const updatedContent = { ...layer.model3dContent };

          // Merge top-level properties
          Object.keys(updates).forEach((key) => {
            if (key === 'echo' && updates.echo) {
              updatedContent.echo = { ...updatedContent.echo, ...updates.echo };
            } else if (key === 'camera' && updates.camera) {
              updatedContent.camera = { ...updatedContent.camera, ...updates.camera };
            } else if (key === 'audio' && updates.audio) {
              updatedContent.audio = { ...updatedContent.audio, ...updates.audio };
            } else if (key === 'diffuseTexture' && updates.diffuseTexture) {
              updatedContent.diffuseTexture = { ...updatedContent.diffuseTexture, ...updates.diffuseTexture };
            } else if (key === 'normalTexture' && updates.normalTexture) {
              updatedContent.normalTexture = { ...updatedContent.normalTexture, ...updates.normalTexture };
            } else if (key === 'emissiveTexture' && updates.emissiveTexture) {
              updatedContent.emissiveTexture = { ...updatedContent.emissiveTexture, ...updates.emissiveTexture };
            } else {
              (updatedContent as any)[key] = (updates as any)[key];
            }
          });

          return { ...layer, model3dContent: updatedContent };
        }),
      }));
    },

    setModel3DModelData(layerId: string, modelData: string, format: string, name: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.model3dContent
            ? {
                ...layer,
                model3dContent: {
                  ...layer.model3dContent,
                  modelData,
                  modelFormat: format as any,
                  modelName: name,
                },
              }
            : layer
        ),
      }));
    },

    updateTextContent(layerId: string, updates: Partial<TextContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.textContent
            ? { ...layer, textContent: { ...layer.textContent, ...updates } }
            : layer
        ),
      }));
    },

    updateTextAnimation(layerId: string, updates: Partial<TextAnimation>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.textContent
            ? {
                ...layer,
                textContent: {
                  ...layer.textContent,
                  animation: { ...layer.textContent.animation, ...updates },
                },
              }
            : layer
        ),
      }));
    },

    // Light painting methods
    updateLightPaintingContent(layerId: string, updates: Partial<LightPaintingContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? { ...layer, lightPaintingContent: { ...layer.lightPaintingContent, ...updates } }
            : layer
        ),
      }));
    },

    /** Patch a pixel-fx layer's content. Used by the PixelFX panel
     *  for every parameter change — the WebGPU renderer reads the
     *  layer's content each frame so a single store update is the
     *  whole sync path. */
    updatePixelFXContent(layerId: string, updates: Partial<PixelFXContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.pixelFXContent
            ? { ...layer, pixelFXContent: { ...layer.pixelFXContent, ...updates } }
            : layer
        ),
      }));
    },

    addLightPaintingStroke(layerId: string, stroke: LightPaintingStroke) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? {
                ...layer,
                lightPaintingContent: {
                  ...layer.lightPaintingContent,
                  strokes: [...layer.lightPaintingContent.strokes, stroke],
                },
              }
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    removeLightPaintingStroke(layerId: string, strokeId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? {
                ...layer,
                lightPaintingContent: {
                  ...layer.lightPaintingContent,
                  strokes: layer.lightPaintingContent.strokes.filter(s => s.id !== strokeId),
                  selectedStrokeId: layer.lightPaintingContent.selectedStrokeId === strokeId
                    ? null
                    : layer.lightPaintingContent.selectedStrokeId,
                },
              }
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    updateLightPaintingStrokeBrush(layerId: string, strokeId: string, brush: import('../types').LightPaintingBrush) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? {
                ...layer,
                lightPaintingContent: {
                  ...layer.lightPaintingContent,
                  strokes: layer.lightPaintingContent.strokes.map(s =>
                    s.id === strokeId ? { ...s, brush: { ...brush } } : s
                  ),
                },
              }
            : layer
        ),
      }));
    },

    // Replace the entire points array of a stroke. Used by path-edit mode
    // when handle drags warp a neighbourhood of raw points. The caller
    // pre-computes the new array (Catmull-Rom warp for freehand, anchor
    // move for pen-mode) and passes it whole — keeps the warp math in
    // one place (the UI) and the store side immutable + simple.
    //
    // If the stroke is a pen-mode stroke, optionally pass newPenPoints
    // to keep penPoints in sync so future edits / re-renders work.
    updateLightPaintingStrokePoints(
      layerId: string,
      strokeId: string,
      newPoints: import('../types').LightPaintingStrokePoint[],
      newPenPoints?: import('../types').LightPaintingPenPoint[],
    ) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? {
                ...layer,
                lightPaintingContent: {
                  ...layer.lightPaintingContent,
                  strokes: layer.lightPaintingContent.strokes.map(s =>
                    s.id === strokeId
                      ? {
                          ...s,
                          points: newPoints,
                          ...(newPenPoints ? { penPoints: newPenPoints } : {}),
                        }
                      : s
                  ),
                },
              }
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    clearLightPaintingStrokes(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.lightPaintingContent
            ? {
                ...layer,
                lightPaintingContent: {
                  ...layer.lightPaintingContent,
                  strokes: [],
                  selectedStrokeId: null,
                },
              }
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    updateColorContent(layerId: string, updates: Partial<ColorContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.colorContent
            ? { ...layer, colorContent: { ...layer.colorContent, ...updates } }
            : layer
        ),
      }));
    },

    // ============================================================================
    // MASK METHODS
    //
    // Masks are now a UNION of multiple sub-polygons, each with bezier handles.
    // The UI builds them one anchor at a time: `addMaskPoint` appends to the
    // last unclosed shape (or starts a new shape if none is open),
    // `closeMaskShape` finalizes it, and a fresh `addMaskPoint` after closing
    // starts the next sub-polygon.
    // ============================================================================
    enableMask(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          // If a mask already exists (e.g. from a prior disable), force enabled=true
          // while preserving its shapes/feather/inverted. Without the explicit
          // override, `mask: layer.mask || {...}` short-circuits to the existing
          // (still disabled) object and the toggle never re-enables.
          return {
            ...layer,
            mask: layer.mask
              ? { ...layer.mask, enabled: true }
              : { enabled: true, shapes: [], inverted: false, feather: 0 },
          };
        }),
      }));
    },

    disableMask(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? { ...layer, mask: { ...layer.mask, enabled: false } }
            : layer
        ),
      }));
    },

    clearMask(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId
            ? { ...layer, mask: null }
            : layer
        ),
      }));
    },

    /**
     * Append an anchor to the last UNCLOSED shape. If every shape is closed
     * (or no shapes exist yet) a new open shape is started with this point.
     * Caller passes a BezierPoint so the same call can carry handle data when
     * the pen tool ends a click-and-drag gesture.
     */
    addMaskPoint(layerId: string, point: BezierPoint) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          const lastIdx = shapes.length - 1;
          const lastShape = lastIdx >= 0 ? shapes[lastIdx] : null;
          let newShapes: MaskShape[];
          if (lastShape && !lastShape.closed) {
            newShapes = shapes.map((s, i) =>
              i === lastIdx ? { ...s, points: [...s.points, point] } : s
            );
          } else {
            newShapes = [...shapes, { points: [point], closed: false }];
          }
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    /**
     * Close the last unclosed sub-polygon. No-op if no unclosed shape exists
     * or if the trailing shape has fewer than 3 anchors.
     */
    closeMaskShape(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          const lastIdx = shapes.length - 1;
          if (lastIdx < 0) return layer;
          const last = shapes[lastIdx];
          if (last.closed || last.points.length < 3) return layer;
          const newShapes = shapes.map((s, i) =>
            i === lastIdx ? { ...s, closed: true } : s
          );
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    updateMaskPoint(layerId: string, shapeIndex: number, pointIndex: number, partial: Partial<BezierPoint>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          if (shapeIndex < 0 || shapeIndex >= shapes.length) return layer;
          const shape = shapes[shapeIndex];
          if (pointIndex < 0 || pointIndex >= shape.points.length) return layer;
          const newShapes = shapes.map((s, si) => {
            if (si !== shapeIndex) return s;
            return {
              ...s,
              points: s.points.map((p, pi) => (pi === pointIndex ? { ...p, ...partial } : p)),
            };
          });
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    /**
     * Remove an entire sub-polygon from the mask. Used by the per-shape
     * delete buttons in the LayerPanel.
     */
    removeMaskShape(layerId: string, shapeIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          if (shapeIndex < 0 || shapeIndex >= shapes.length) return layer;
          const newShapes = shapes.filter((_, i) => i !== shapeIndex);
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    /**
     * Insert a new anchor between `edgeIndex` and `edgeIndex+1` of a closed
     * mask shape. Used by the add-point pen-tool mode so the user can click
     * an edge to insert a knot mid-segment without redrawing the shape.
     *
     * Only acts on closed shapes; open shapes use `addMaskPoint` instead
     * because the append semantics are well-defined while the polygon is
     * still being drawn. The new point is a sharp corner (no bezier
     * handles) so the inserted edge stays visually identical until the
     * user drags the new anchor's handles to bend it.
     */
    insertMaskPoint(layerId: string, shapeIndex: number, edgeIndex: number, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          if (shapeIndex < 0 || shapeIndex >= shapes.length) return layer;
          const shape = shapes[shapeIndex];
          if (!shape.closed) return layer;
          const ptCount = shape.points.length;
          if (ptCount < 2 || edgeIndex < 0 || edgeIndex >= ptCount) return layer;
          const insertAt = edgeIndex + 1; // place between edgeIndex and (edgeIndex+1)%N
          const newPoint: BezierPoint = { x: point.x, y: point.y };
          const newPoints = [
            ...shape.points.slice(0, insertAt),
            newPoint,
            ...shape.points.slice(insertAt),
          ];
          const newShapes = shapes.map((s, si) =>
            si === shapeIndex ? { ...s, points: newPoints } : s,
          );
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    removeMaskPoint(layerId: string, shapeIndex: number, pointIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          if (shapeIndex < 0 || shapeIndex >= shapes.length) return layer;
          const shape = shapes[shapeIndex];
          if (pointIndex < 0 || pointIndex >= shape.points.length) return layer;
          const remainingPts = shape.points.filter((_, i) => i !== pointIndex);
          let newShapes: MaskShape[];
          if (remainingPts.length < 2) {
            // Drop the now-degenerate shape entirely
            newShapes = shapes.filter((_, i) => i !== shapeIndex);
          } else {
            newShapes = shapes.map((s, si) =>
              si === shapeIndex ? { ...s, points: remainingPts } : s
            );
          }
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    /**
     * Set or clear an individual bezier handle on a specific anchor.
     * Pass `null` for `point` to remove the handle (anchor becomes a sharp corner on that side).
     */
    setMaskPointHandle(layerId: string, shapeIndex: number, pointIndex: number, which: 'cpIn' | 'cpOut', point: Point2D | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.mask) return layer;
          const shapes = layer.mask.shapes ?? [];
          if (shapeIndex < 0 || shapeIndex >= shapes.length) return layer;
          const shape = shapes[shapeIndex];
          if (pointIndex < 0 || pointIndex >= shape.points.length) return layer;
          const newShapes = shapes.map((s, si) => {
            if (si !== shapeIndex) return s;
            return {
              ...s,
              points: s.points.map((p, pi) => {
                if (pi !== pointIndex) return p;
                const updated: BezierPoint = { ...p };
                if (point === null) {
                  delete updated[which];
                } else {
                  updated[which] = point;
                }
                return updated;
              }),
            };
          });
          return { ...layer, mask: { ...layer.mask, shapes: newShapes } };
        }),
      }));
    },

    toggleMaskInvert(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? { ...layer, mask: { ...layer.mask, inverted: !layer.mask.inverted } }
            : layer
        ),
      }));
    },

    setMaskFeather(layerId: string, feather: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? { ...layer, mask: { ...layer.mask, feather } }
            : layer
        ),
      }));
    },

    // ============================================================================
    // CUSTOM SHAPE METHODS (pen-tool polygon on media layers)
    // ============================================================================

    addCustomShapePoint(layerId: string, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: { ...layer.layerShape.params, customPoints: [...pts, point] },
            },
          };
        }),
      }));
    },

    updateCustomShapePoint(layerId: string, pointIndex: number, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                customPoints: pts.map((p, i) => (i === pointIndex ? point : p)),
              },
            },
          };
        }),
      }));
    },

    removeCustomShapePoint(layerId: string, pointIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          if (pts.length <= 3) return layer; // Minimum 3 vertices
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                customPoints: pts.filter((_, i) => i !== pointIndex),
              },
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    closeCustomShape(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          if (pts.length < 3) return layer; // Need at least 3 points to close
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                customClosed: true,
                // Snapshot the outline as drawn: later vertex drags warp the
                // content against this base (content-follow).
                customBasePoints: pts.map((point) => ({ ...point })),
              },
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    insertCustomShapePoint(layerId: string, afterIndex: number, point: BezierPoint) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = [...(layer.layerShape.params.customPoints ?? [])];
          pts.splice(afterIndex + 1, 0, point);
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: { ...layer.layerShape.params, customPoints: pts },
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    updateCustomShapeHandle(layerId: string, pointIndex: number, handleType: 'cpIn' | 'cpOut', pos: Point2D | undefined) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                customPoints: pts.map((p, i) => (i === pointIndex ? { ...p, [handleType]: pos } : p)),
              },
            },
          };
        }),
      }));
    },

    toggleCustomShapePointCurve(layerId: string, pointIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || layer.layerShape.type !== 'custom') return layer;
          const pts = layer.layerShape.params.customPoints ?? [];
          const pt = pts[pointIndex];
          if (!pt) return layer;
          const hasCurve = pt.cpIn || pt.cpOut;
          let newPt: BezierPoint;
          if (hasCurve) {
            // Convert to corner: remove handles
            newPt = { x: pt.x, y: pt.y };
          } else {
            // Convert to curve: auto-generate handles from neighbors
            const prevPt = pts[(pointIndex - 1 + pts.length) % pts.length];
            const nextPt = pts[(pointIndex + 1) % pts.length];
            const dx = (nextPt.x - prevPt.x) * 0.25;
            const dy = (nextPt.y - prevPt.y) * 0.25;
            newPt = {
              x: pt.x, y: pt.y,
              cpIn: { x: pt.x - dx, y: pt.y - dy },
              cpOut: { x: pt.x + dx, y: pt.y + dy },
            };
          }
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                customPoints: pts.map((p, i) => (i === pointIndex ? newPt : p)),
              },
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    convertToCustomShape(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape) return layer;
          if (layer.layerShape.type === 'custom') return layer;
          return {
            ...layer,
            layerShape: convertShapeToCustom(layer.layerShape),
          };
        }),
      }));
      recordDiscreteAction();
    },

    // ============================================================================
    // EDGE EFFECTS METHODS (drawing-style effects on media layer shape edges)
    // ============================================================================

    enableEdgeEffects(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId
            ? { ...layer, edgeEffects: { enabled: true, effects: [createDefaultEdgeEffect()] } }
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    disableEdgeEffects(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, edgeEffects: null } : layer
        ),
      }));
      recordDiscreteAction();
    },

    addEdgeEffect(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.edgeEffects) return layer;
          return {
            ...layer,
            edgeEffects: {
              ...layer.edgeEffects,
              effects: [...layer.edgeEffects.effects, createDefaultEdgeEffect()],
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    removeEdgeEffect(layerId: string, effectId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.edgeEffects) return layer;
          return {
            ...layer,
            edgeEffects: {
              ...layer.edgeEffects,
              effects: layer.edgeEffects.effects.filter((e) => e.id !== effectId),
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    updateEdgeEffect(layerId: string, effectId: string, updates: Partial<EdgeEffect>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.edgeEffects) return layer;
          return {
            ...layer,
            edgeEffects: {
              ...layer.edgeEffects,
              effects: layer.edgeEffects.effects.map((e) =>
                e.id === effectId ? { ...e, ...updates } : e
              ),
            },
          };
        }),
      }));
    },

    toggleEdgeEffectsEnabled(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.edgeEffects) return layer;
          return {
            ...layer,
            edgeEffects: { ...layer.edgeEffects, enabled: !layer.edgeEffects.enabled },
          };
        }),
      }));
    },

    // ============================================================================
    // CROP REGION METHODS (per-layer input slice)
    // ============================================================================

    setCropRegion(layerId: string, cropRegion: CropRegion | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, cropRegion } : layer
        ),
      }));
    },

    updateCropRegion(layerId: string, updates: Partial<CropRegion>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.cropRegion
            ? { ...layer, cropRegion: { ...layer.cropRegion, ...updates } }
            : layer.id === layerId
              ? { ...layer, cropRegion: { ...createDefaultCropRegion(), ...updates } }
              : layer
        ),
      }));
    },

    resetCropRegion(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, cropRegion: null } : layer
        ),
      }));
    },

    // ============================================================================
    // LAYER SHAPE METHODS (shape mask: circle, triangle, line, etc.)
    // ============================================================================

    setLayerShape(layerId: string, shapeType: LayerShapeType | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId
            ? (
              (layer.layerShape?.type ?? null) === shapeType
                ? layer
                : {
                    ...layer,
                    // Shape is now the primary geometry path for media layers.
                    // Clear legacy crop state to avoid crop-like behavior stacking.
                    cropRegion: null,
                    layerShape: shapeType ? createDefaultLayerShape(shapeType) : null,
                  }
            )
            : layer
        ),
      }));
      recordDiscreteAction();
    },

    updateLayerShape(layerId: string, updates: Partial<LayerShape>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.layerShape
            ? { ...layer, layerShape: { ...layer.layerShape, ...updates } }
            : layer
        ),
      }));
    },

    updateLayerShapeParams(layerId: string, params: Partial<import('../types').LayerShapeParams>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.layerShape
            ? {
                ...layer,
                layerShape: {
                  ...layer.layerShape,
                  params: { ...layer.layerShape.params, ...params },
                },
              }
            : layer
        ),
      }));
    },

    toggleLayerShapeEnabled(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.layerShape
            ? { ...layer, layerShape: { ...layer.layerShape, enabled: !layer.layerShape.enabled } }
            : layer
        ),
      }));
    },

    clearLayerShape(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, layerShape: null } : layer
        ),
      }));
    },

    // Add/update polyline points for line shapes
    addLayerShapeLinePoint(layerId: string, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape) return layer;
          const currentPoints = layer.layerShape.params.linePoints || [];
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                linePoints: [...currentPoints, point],
              },
            },
          };
        }),
      }));
    },

    updateLayerShapeLinePoint(layerId: string, pointIndex: number, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || !layer.layerShape.params.linePoints) return layer;
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                linePoints: layer.layerShape.params.linePoints.map((p, i) =>
                  i === pointIndex ? point : p
                ),
              },
            },
          };
        }),
      }));
    },

    removeLayerShapeLinePoint(layerId: string, pointIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId || !layer.layerShape || !layer.layerShape.params.linePoints) return layer;
          return {
            ...layer,
            layerShape: {
              ...layer.layerShape,
              params: {
                ...layer.layerShape.params,
                linePoints: layer.layerShape.params.linePoints.filter((_, i) => i !== pointIndex),
              },
            },
          };
        }),
      }));
    },

    removeLayer(id: string) {
      update((project) => {
        const removed = project.layers.find(l => l.id === id);
        // If removing a group, orphan its children first
        let newLayers = removed?.type === 'group'
          ? project.layers.map(l => l.parentGroupId === id ? { ...l, parentGroupId: null } : l)
          : project.layers;
        newLayers = newLayers.filter((l) => l.id !== id);
        const nextSelectedLayerId =
          project.selectedLayerId === id
            ? newLayers[newLayers.length - 1]?.id || null
            : project.selectedLayerId;
        const nextSelection = normalizeSelectedLayerIds(
          get(selectedLayerIdsState).filter(layerId => layerId !== id),
          newLayers.map(l => l.id)
        );
        selectedLayerIdsState.set(
          nextSelection.length > 0
            ? nextSelection
            : nextSelectedLayerId
              ? [nextSelectedLayerId]
              : []
        );
        return {
          ...project,
          layers: newLayers,
          selectedLayerId: nextSelectedLayerId,
        };
      });
      recordDiscreteAction();
    },

    duplicateLayer(id: string) {
      // SAFE clone: structuredClone throws DataCloneError on Layers that
      // hold live DOM/WebGL handles (video elements, image elements,
      // THREE.Texture references on splat/3D layers, etc.). The thrown
      // exception silently aborted the whole `update()` callback, which
      // is why the right-click "Duplicate" appeared to do nothing for
      // any layer with media. Strategy: first JSON-roundtrip to drop
      // non-serializable fields, then re-fill the safe-to-share refs
      // (`source` keeps its id but loses the live element — the engine
      // will rehydrate from the MediaSource registry on first render).
      const safeCloneLayer = (l: Layer): Layer => {
        // JSON.parse(JSON.stringify) silently drops functions, DOM nodes,
        // and circular refs — perfect for stripping cloneability hazards
        // while preserving all the plain config data we want copied.
        const cloned: Layer = JSON.parse(JSON.stringify(l));
        // Source: keep identifier + type so the engine re-resolves to the
        // existing MediaSource entry. videoEl / imageEl / texture handles
        // would have been dropped by JSON anyway.
        if (l.source && cloned.source) {
          cloned.source = { ...cloned.source };
        }
        return cloned;
      };

      update((project) => {
        const layer = project.layers.find((l) => l.id === id);
        if (!layer) return project;

        let cloned: Layer;
        try {
          cloned = safeCloneLayer(layer);
        } catch (err) {
          console.error('[duplicateLayer] clone failed:', err);
          return project;
        }
        const newId = generateUUID();
        const newLayer: Layer = {
          ...cloned,
          id: newId,
          name: `${layer.name} Copy`,
        };

        const index = project.layers.findIndex((l) => l.id === id);
        const newLayers = [...project.layers];

        if (layer.type === 'group') {
          const children = project.layers.filter(l => l.parentGroupId === id);
          const clonedChildren: Layer[] = [];
          for (const child of children) {
            try {
              clonedChildren.push({
                ...safeCloneLayer(child),
                id: generateUUID(),
                parentGroupId: newId,
              });
            } catch (err) {
              console.warn('[duplicateLayer] failed to clone child', child.id, err);
            }
          }
          let blockEnd = index;
          for (let i = index + 1; i < project.layers.length; i++) {
            if (project.layers[i].parentGroupId === id) blockEnd = i;
            else break;
          }
          newLayers.splice(blockEnd + 1, 0, newLayer, ...clonedChildren);
        } else {
          newLayers.splice(index + 1, 0, newLayer);
        }

        return {
          ...project,
          layers: newLayers,
          selectedLayerId: newId,
        };
      });
      selectedLayerIdsState.set([get(project).selectedLayerId!]);
      recordDiscreteAction();
    },

    /** Rename a layer. Empty / whitespace-only names are rejected so the
     *  thumbnail row never shows a blank label. */
    renameLayer(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
      }));
      recordDiscreteAction();
    },

    reorderLayers(fromIndex: number, toIndex: number) {
      update((project) => {
        const newLayers = [...project.layers];
        const moved = newLayers[fromIndex];
        if (!moved) return project;

        // If moving a group, move it + all its children as a block
        if (moved.type === 'group') {
          const blockIds = [moved.id];
          for (let i = fromIndex + 1; i < newLayers.length; i++) {
            if (newLayers[i].parentGroupId === moved.id) blockIds.push(newLayers[i].id);
            else break;
          }
          const block = newLayers.filter(l => blockIds.includes(l.id));
          const remaining = newLayers.filter(l => !blockIds.includes(l.id));
          const adjustedTo = Math.min(toIndex, remaining.length);
          remaining.splice(adjustedTo, 0, ...block);
          return { ...project, layers: remaining };
        }

        // Single layer move
        newLayers.splice(fromIndex, 1);
        newLayers.splice(toIndex, 0, moved);
        return { ...project, layers: newLayers };
      });
      recordDiscreteAction();
    },

    selectLayer(id: string | null) {
      update((project) => ({ ...project, selectedLayerId: id }));
      selectedLayerIdsState.set(id ? [id] : []);
    },

    setLayerSelection(primaryLayerId: string | null, layerIds: string[]) {
      update((currentProject) => {
        const validIds = currentProject.layers.map(l => l.id);
        const normalized = normalizeSelectedLayerIds(layerIds, validIds);
        const nextPrimary = primaryLayerId && validIds.includes(primaryLayerId)
          ? primaryLayerId
          : normalized[0] ?? null;
        selectedLayerIdsState.set(
          normalized.length > 0
            ? normalized
            : nextPrimary
              ? [nextPrimary]
              : []
        );
        return { ...currentProject, selectedLayerId: nextPrimary };
      });
    },

    setSelectedLayerIds(layerIds: string[]) {
      update((currentProject) => {
        const validIds = currentProject.layers.map(l => l.id);
        const normalized = normalizeSelectedLayerIds(layerIds, validIds);
        const currentPrimaryValid =
          !!currentProject.selectedLayerId && normalized.includes(currentProject.selectedLayerId);
        const nextPrimary = currentPrimaryValid
          ? currentProject.selectedLayerId
          : normalized[0] ?? null;
        selectedLayerIdsState.set(
          normalized.length > 0
            ? normalized
            : nextPrimary
              ? [nextPrimary]
              : []
        );
        return { ...currentProject, selectedLayerId: nextPrimary };
      });
    },

    // Layer property updates
    updateLayer(id: string, updates: Partial<Layer>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      }));
    },

    setLayerSource(id: string, source: MediaSource | null) {
      // Debug trace — set window.__VIDEO_DEBUG__ = true to see every
      // setLayerSource call with the caller stack so we can localize
      // which path is mutating layer.source mid-frame.
      if (typeof window !== 'undefined' && (window as any).__VIDEO_DEBUG__) {
        const stack = new Error().stack?.split('\n').slice(2, 6).map(s => s.trim()).join(' / ') || 'no-stack';
        const srcShort = (source?.src || '').slice(-40);
        console.log(`[setLayerSource] layer=${id.slice(0, 8)} type=${source?.type ?? 'null'} src=${srcShort} stack=${stack}`);
      }

      update((project) => {
        // Find the old layer source to clean up
        const oldLayer = project.layers.find(l => l.id === id);
        if (oldLayer?.type === 'mask' && source) {
          console.warn('[setLayerSource] Mask layers do not accept media sources.');
          return project;
        }
        const oldSource = oldLayer?.source;

        // Compare on `src` (the actual media identity), NOT on `id` (a fresh
        // UUID generated on every apply-to-layer call). Pre-fix: re-applying
        // the same media file produced two MediaSource objects with the
        // same src but different UUIDs → the second apply disposed the
        // freshly-loaded texture mid-load → "video freezes on first frame".
        const srcChanged = !!oldSource && oldSource.src !== source?.src;

        // Dispose old JS animation context if the underlying source genuinely changed
        if (oldSource && oldSource.jsAnimation && srcChanged) {
          console.log('Disposing old JS animation context:', oldSource.id, oldSource.name);
          disposeJSAnimationContext(oldSource.id);
        }

        // DO NOT dispose `oldSource.texture` here.
        //
        // The texture object on `oldSource.texture` is the SAME reference
        // held by Canvas.svelte's `textureCache` (assigned by
        // updateTexturesSync from the URL-keyed cache). Disposing it here
        // leaves the cache pointing at a dead texture, so when the user
        // switches BACK to a previously-seen clip the cache hit returns a
        // disposed VideoTexture and the new layer freezes on the last
        // sampled frame.
        //
        // Texture lifetime is owned by Canvas.svelte's textureCache with
        // LRU eviction (`evictTextureCache`). When the cache evicts an
        // entry it disposes the texture properly. setLayerSource just
        // changes which source the layer points at — the texture stays
        // alive for fast switch-back until LRU reclaims it.

        return {
          ...project,
          layers: project.layers.map((l) => {
            if (l.id !== id) return l;
            const nextName = shouldAutoRenameMediaLayer(l, source) ? cleanMediaSourceName(source) : l.name;
            if (isVideoSource(source)) rehydrateVideoSource(source);
            return { ...l, name: nextName, source };
          }),
        };
      });
      recordDiscreteAction();
    },

    /** Lightweight shader value update for per-frame modulation — no history, no dispose checks */
    batchUpdateLayerShaderValues(id: string, values: Record<string, number>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.source || !l.source.shaderValues) return l;
          return { ...l, source: { ...l.source, shaderValues: { ...l.source.shaderValues, ...values } } };
        }),
      }));
    },

    setLayerOpacity(id: string, opacity: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
      }));
    },

    setLayerBlendMode(id: string, blendMode: BlendMode) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, blendMode } : l)),
      }));
      recordDiscreteAction();
    },

    setContentFit(id: string, contentFit: import('../types').ContentFitMode) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, contentFit } : l)),
      }));
      recordDiscreteAction();
    },

    /** undefined clears the override so the layer follows the global tier. */
    setRenderQuality(id: string, renderQuality: number | undefined) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, renderQuality } : l)),
      }));
      recordDiscreteAction();
    },

    toggleLayerVisibility(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
      }));
      recordDiscreteAction();
    },

    toggleLayerLock(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
      }));
      recordDiscreteAction();
    },

    // Warp control
    setCorner(id: string, corner: keyof WarpCorners, position: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                corners: { ...l.corners, [corner]: position },
              }
            : l
        ),
      }));
    },

    resetCorners(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                corners: createDefaultCorners(),
              }
            : l
        ),
      }));
      recordDiscreteAction();
    },

    // Transform controls
    setLayerPosition(id: string, position: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, position } : l)),
      }));
    },

    setLayerRotation(id: string, rotation: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, rotation } : l)),
      }));
    },

    toggleLayerFlipH(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, flipH: !l.flipH } : l)),
      }));
    },

    toggleLayerFlipV(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => (l.id === id ? { ...l, flipV: !l.flipV } : l)),
      }));
    },

    // Warp mode
    setWarpMode(id: string, warpMode: WarpMode) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id) return l;
          // Initialize mesh grid if switching to mesh mode and not already set
          const meshGrid = warpMode === 'mesh' && !l.meshGrid ? createMeshGrid(3, 3) : l.meshGrid;
          return { ...l, warpMode, meshGrid };
        }),
      }));
      recordDiscreteAction();
    },

    // Mesh warp
    setMeshPoint(id: string, row: number, col: number, position: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.meshGrid) return l;
          const newPoints = l.meshGrid.points.map((r, ri) =>
            r.map((p, ci) => (ri === row && ci === col ? position : p))
          );
          return { ...l, meshGrid: { ...l.meshGrid, points: newPoints } };
        }),
      }));
    },

    setMeshGridSize(id: string, rows: number, cols: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id) return l;
          return { ...l, meshGrid: createMeshGrid(rows, cols) };
        }),
      }));
      recordDiscreteAction();
    },

    resetMeshGrid(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.meshGrid) return l;
          return { ...l, meshGrid: createMeshGrid(l.meshGrid.rows, l.meshGrid.cols) };
        }),
      }));
      recordDiscreteAction();
    },

    // Shape control point manipulation
    setShapeControlPoint(id: string, pointIndex: number, position: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.layerShape || !l.layerShape.controlPoints) return l;
          const newControlPoints = l.layerShape.controlPoints.map((p, i) =>
            i === pointIndex ? position : p
          );
          return {
            ...l,
            layerShape: {
              ...l.layerShape,
              controlPoints: newControlPoints,
            },
          };
        }),
      }));
    },

    initShapeControlPoints(id: string, controlPoints: Point2D[]) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.layerShape) return l;
          return {
            ...l,
            layerShape: {
              ...l.layerShape,
              controlPoints,
            },
          };
        }),
      }));
    },

    resetShapeControlPoints(id: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== id || !l.layerShape) return l;
          // Remove control points to let the geometry generator create defaults
          return {
            ...l,
            layerShape: {
              ...l.layerShape,
              controlPoints: undefined,
            },
          };
        }),
      }));
      recordDiscreteAction();
    },

    // Effect management
    addEffect(layerId: string, effectType: EffectType, params?: EffectParams) {
      if (NATIVE_ENGINE_ONLY && !isNativeSelectableEffect(effectType)) {
        console.warn(`[layers] blocked non-native effect in native-only mode: ${effectType}`);
        return;
      }
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          const newEffect: Effect = {
            id: generateUUID(),
            type: effectType,
            enabled: true,
            params: params || {},
          };
          return { ...l, effects: [...l.effects, newEffect] };
        }),
      }));
      recordDiscreteAction();
    },

    addEffectInstance(layerId: string, effect: Effect) {
      if (NATIVE_ENGINE_ONLY && !isNativeSelectableEffect(effect.type)) {
        console.warn(`[layers] blocked non-native effect instance in native-only mode: ${effect.type}`);
        return;
      }
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          if (l.effects.some((existing) => existing.id === effect.id)) return l;
          return { ...l, effects: [...l.effects, effect] };
        }),
      }));
      recordDiscreteAction();
    },

    removeEffect(layerId: string, effectId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return { ...l, effects: l.effects.filter((e) => e.id !== effectId) };
        }),
      }));
      recordDiscreteAction();
    },

    updateEffect(layerId: string, effectId: string, updates: Partial<Effect>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            effects: l.effects.map((e) => (e.id === effectId ? { ...e, ...updates } : e)),
          };
        }),
      }));
    },

    updateEffectParams(layerId: string, effectId: string, params: Partial<EffectParams>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            effects: l.effects.map((e) =>
              e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
            ),
          };
        }),
      }));
      // Auto-record keyframes for any armed effect parameter tracks
      for (const [paramName, value] of Object.entries(params)) {
        if (typeof value !== 'number' && typeof value !== 'boolean') continue;
        const trackKey = `fx:${effectId}:${paramName}`;
        keyframeTimeline.autoRecord(layerId, trackKey, value, paramName, typeof value === 'boolean' ? 'boolean' : 'number');
      }
    },

    /** Set or clear the Auto playhead config for a single effect param.
     *  Pass `auto=null` to remove the entry (user switching back to
     *  Manual / Audio / LFO). The autoEngine watches this map and
     *  animates whichever params have a non-null entry. */
    setEffectParamAuto(layerId: string, effectId: string, paramName: string, auto: AutoConfig | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            effects: l.effects.map((e) => {
              if (e.id !== effectId) return e;
              const nextAuto = { ...(e.paramAuto ?? {}) };
              if (auto === null) {
                delete nextAuto[paramName];
              } else {
                nextAuto[paramName] = auto;
              }
              // Drop the field entirely when empty so saves stay compact.
              const hasAny = Object.keys(nextAuto).length > 0;
              const { paramAuto: _drop, ...rest } = e;
              return hasAny ? { ...rest, paramAuto: nextAuto } : rest;
            }),
          };
        }),
      }));
    },

    /** Set or clear the Auto playhead config for a single GPU shader-
     *  layer param. Lives on `layer.gpuLayerContent.paramAuto[paramKey]`.
     *  Same drop-when-empty optimisation as setEffectParamAuto so saves
     *  stay tidy when no Auto entries are active. */
    setGPULayerParamAuto(layerId: string, paramKey: string, auto: AutoConfig | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || !l.gpuLayerContent) return l;
          const nextAuto = { ...(l.gpuLayerContent.paramAuto ?? {}) };
          if (auto === null) {
            delete nextAuto[paramKey];
          } else {
            nextAuto[paramKey] = auto;
          }
          const hasAny = Object.keys(nextAuto).length > 0;
          const { paramAuto: _drop, ...rest } = l.gpuLayerContent;
          return {
            ...l,
            gpuLayerContent: hasAny ? { ...rest, paramAuto: nextAuto } : rest,
          };
        }),
      }));
    },

    /** Set or clear the Auto playhead config for a splat / point-cloud
     * parameter. The sidecar lives with splatContent so project saves
     * preserve automation without introducing a second state owner. */
    setSplatParamAuto(layerId: string, paramKey: string, auto: AutoConfig | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || !l.splatContent) return l;
          const nextAuto = { ...(l.splatContent.paramAuto ?? {}) };
          if (auto === null) {
            delete nextAuto[paramKey];
          } else {
            nextAuto[paramKey] = auto;
          }
          const hasAny = Object.keys(nextAuto).length > 0;
          const { paramAuto: _drop, ...rest } = l.splatContent;
          return {
            ...l,
            splatContent: hasAny ? { ...rest, paramAuto: nextAuto } : rest,
          };
        }),
      }));
    },

    /** Set or clear the Auto playhead config for a single edge-effect
     *  param. `paramPath` uses the same dot notation as the rest of the
     *  edge-effect modulation path (`stroke.width`, `fill.speed`,
     *  `animation.count`, or a top-level key like `opacity`). The auto
     *  map is flat — keys are the dotted strings as-is. */
    setEdgeEffectParamAuto(layerId: string, effectId: string, paramPath: string, auto: AutoConfig | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || !l.edgeEffects) return l;
          return {
            ...l,
            edgeEffects: {
              ...l.edgeEffects,
              effects: l.edgeEffects.effects.map((e) => {
                if (e.id !== effectId) return e;
                const nextAuto = { ...(e.paramAuto ?? {}) };
                if (auto === null) {
                  delete nextAuto[paramPath];
                } else {
                  nextAuto[paramPath] = auto;
                }
                const hasAny = Object.keys(nextAuto).length > 0;
                const { paramAuto: _drop, ...rest } = e;
                return hasAny ? { ...rest, paramAuto: nextAuto } : rest;
              }),
            },
          };
        }),
      }));
    },

    /** Set or clear the Auto playhead config for a single shader-param
     *  input on a mapping layer's MediaSource. Mirrors
     *  setEffectParamAuto. */
    setShaderValueAuto(layerId: string, paramName: string, auto: AutoConfig | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || !l.source) return l;
          const nextAuto = { ...(l.source.shaderValueAuto ?? {}) };
          if (auto === null) {
            delete nextAuto[paramName];
          } else {
            nextAuto[paramName] = auto;
          }
          const hasAny = Object.keys(nextAuto).length > 0;
          const { shaderValueAuto: _drop, ...sourceRest } = l.source;
          return {
            ...l,
            source: hasAny ? { ...sourceRest, shaderValueAuto: nextAuto } : sourceRest,
          };
        }),
      }));
    },

    /** Reset a layer effect's params back to the catalog defaults
     *  (getDefaultEffectParams). Replaces the params object wholesale
     *  rather than merging — half-set state from earlier tweaks
     *  would otherwise leak through if a param had been added/removed
     *  to the catalog since the effect was created. */
    resetEffectParams(layerId: string, effectId: string) {
      let resetType: EffectType | null = null;
      let resetParams: EffectParams | null = null;
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            effects: l.effects.map((e) => {
              if (e.id !== effectId) return e;
              resetType = e.type;
              resetParams = getDefaultEffectParams(e.type);
              return { ...e, params: resetParams };
            }),
          };
        }),
      }));
      // Auto-record the reset values too so a running timeline
      // captures the snap-back as a keyframe at the playhead.
      if (resetType && resetParams) {
        for (const [paramName, value] of Object.entries(resetParams)) {
          if (typeof value !== 'number' && typeof value !== 'boolean') continue;
          const trackKey = `fx:${effectId}:${paramName}`;
          keyframeTimeline.autoRecord(layerId, trackKey, value, paramName, typeof value === 'boolean' ? 'boolean' : 'number');
        }
      }
    },

    // ========== Mapping Composition ==========

    setMappingCompositionEnabled(enabled: boolean) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            enabled,
          },
        };
      });
      recordDiscreteAction();
    },

    addMappingCompositionEffect(effectType: EffectType, params?: EffectParams) {
      if (NATIVE_ENGINE_ONLY && !isNativeSelectableEffect(effectType)) {
        console.warn(`[layers] blocked non-native mapping composition effect in native-only mode: ${effectType}`);
        return;
      }
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        const effect: Effect = {
          id: generateUUID(),
          type: effectType,
          enabled: true,
          params: params ?? getDefaultEffectParams(effectType),
          opacity: 1,
          blendMode: 'normal',
        };
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            enabled: true,
            effects: [...mappingComposition.effects, effect],
          },
        };
      });
      recordDiscreteAction();
    },

    removeMappingCompositionEffect(effectId: string) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects: mappingComposition.effects.filter((effect) => effect.id !== effectId),
          },
        };
      });
      recordDiscreteAction();
    },

    toggleMappingCompositionEffect(effectId: string) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects: mappingComposition.effects.map((effect) =>
              effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect
            ),
          },
        };
      });
    },

    updateMappingCompositionEffect(effectId: string, updates: Partial<Effect>) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects: mappingComposition.effects.map((effect) =>
              effect.id === effectId ? { ...effect, ...updates } : effect
            ),
          },
        };
      });
    },

    updateMappingCompositionEffectParams(effectId: string, params: Partial<EffectParams>) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects: mappingComposition.effects.map((effect) =>
              effect.id === effectId ? { ...effect, params: { ...effect.params, ...params } } : effect
            ),
          },
        };
      });
    },

    resetMappingCompositionEffectParams(effectId: string) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects: mappingComposition.effects.map((effect) =>
              effect.id === effectId ? { ...effect, params: getDefaultEffectParams(effect.type) } : effect
            ),
          },
        };
      });
    },

    reorderMappingCompositionEffects(fromIndex: number, toIndex: number) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        const effects = [...mappingComposition.effects];
        if (fromIndex < 0 || fromIndex >= effects.length || toIndex < 0 || toIndex >= effects.length) {
          return p;
        }
        const [moved] = effects.splice(fromIndex, 1);
        effects.splice(toIndex, 0, moved);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            effects,
          },
        };
      });
      recordDiscreteAction();
    },

    addMappingStageEffect(effect: StageEffect) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        const stageEffects = [...mappingComposition.stageEffects, effect];
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            enabled: true,
            stageEffects,
            activeStageEffectId: mappingComposition.activeStageEffectId ?? effect.id,
          },
        };
      });
      recordDiscreteAction();
    },

    removeMappingStageEffect(effectId: string) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        const stageEffects = mappingComposition.stageEffects.filter((effect) => effect.id !== effectId);
        const activeStageEffectId = mappingComposition.activeStageEffectId === effectId
          ? (stageEffects[0]?.id ?? null)
          : mappingComposition.activeStageEffectId;
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffects,
            activeStageEffectId,
          },
        };
      });
      recordDiscreteAction();
    },

    setMappingStageEffectActive(effectId: string | null) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            activeStageEffectId: effectId,
          },
        };
      });
    },

    toggleMappingStageEffectInTimeline(effectId: string) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffects: mappingComposition.stageEffects.map((effect) =>
              effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect
            ),
          },
        };
      });
    },

    updateMappingStageEffect(effectId: string, updates: Partial<StageEffect>) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffects: mappingComposition.stageEffects.map((effect) =>
              effect.id === effectId ? { ...effect, ...updates } : effect
            ),
          },
        };
      });
    },

    updateMappingStageEffectParam(effectId: string, key: string, value: number) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffects: mappingComposition.stageEffects.map((effect) =>
              effect.id === effectId
                ? { ...effect, params: { ...effect.params, [key]: value } }
                : effect
            ),
          },
        };
      });
    },

    updateMappingStageEffectAutomation(updates: Partial<SurfaceEffectAutomation>) {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffectAutomation: {
              ...mappingComposition.stageEffectAutomation,
              ...updates,
            },
          },
        };
      });
    },

    toggleMappingStageEffectAutomation() {
      update((p) => {
        const mappingComposition = normalizeMappingCompositionState(p.mappingComposition);
        return {
          ...p,
          mappingComposition: {
            ...mappingComposition,
            stageEffectAutomation: {
              ...mappingComposition.stageEffectAutomation,
              playing: !mappingComposition.stageEffectAutomation.playing,
            },
          },
        };
      });
    },

    // ========== Stage Mode: VJ Source Assignment ==========

    /** Set or clear which VJ layer feeds a mapping layer */
    setLayerVJSource(layerId: string, vjLayerIndex: number | undefined) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) =>
          l.id === layerId ? { ...l, vjLayerIndex } : l
        ),
      }));
    },

    // ========== Stage Presets ==========

    /** Save current mapping layers (with VJ assignments) as a stage preset */
    saveStagePreset(name: string, thumbnail?: string): string {
      const currentProject = get({ subscribe });
      const preset = captureStagePresetSnapshot(currentProject, name, thumbnail);

      update((project) => ({
        ...project,
        stagePresets: [...(project.stagePresets || []), preset],
      }));

      return preset.id;
    },

    /** Capture a complete preset without adding it to the project.
     * Global presets use this so they own the same surface/FX/3D state
     * as project presets. */
    createStagePresetSnapshot(
      name: string,
      thumbnail?: string,
      scope: 'project' | 'global' = 'project',
      id?: string,
    ): StagePreset {
      return captureStagePresetSnapshot(get({ subscribe }), name, thumbnail, scope, id);
    },

    /** Load a stage preset — replaces project.layers with the preset's saved layers */
    loadStagePreset(presetId: string) {
      const preset = (get({ subscribe }).stagePresets || []).find(
        candidate => candidate.id === presetId
      );
      if (preset) restoreStagePresetSnapshot(preset);
    },

    /** Restore an external/global Stage preset through the exact same
     * complete path as a project preset. */
    loadStagePresetSnapshot(preset: StagePreset) {
      restoreStagePresetSnapshot(preset);
    },

    /** Delete a stage preset */
    deleteStagePreset(presetId: string) {
      update((project) => ({
        ...project,
        stagePresets: (project.stagePresets || []).filter(p => p.id !== presetId),
      }));
    },

    /** Rename a stage preset */
    renameStagePreset(presetId: string, newName: string) {
      update((project) => ({
        ...project,
        stagePresets: (project.stagePresets || []).map(p =>
          p.id === presetId ? { ...p, name: newName } : p
        ),
      }));
    },

    /** Update a stage preset's thumbnail */
    updateStagePresetThumbnail(presetId: string, thumbnail: string) {
      update((project) => ({
        ...project,
        stagePresets: (project.stagePresets || []).map(p =>
          p.id === presetId ? { ...p, thumbnail } : p
        ),
      }));
    },

    /** Overwrite an existing stage preset's saved layers + effects
     * bundle with the CURRENT state. Used by the "+ Update" button
     * and the right-click "Update Preset" item so the user can
     * iterate on a stage without having to delete + re-save under
     * the same name. Mirrors saveStagePreset's snapshot logic
     * (layers + active surface's effects/active/automation). */
    updateStagePreset(presetId: string, thumbnail?: string) {
      const currentProject = get({ subscribe });
      const existingPreset = (currentProject.stagePresets || []).find(
        preset => preset.id === presetId
      );
      if (!existingPreset) return;
      const snapshot = captureStagePresetSnapshot(
        currentProject,
        existingPreset.name,
        thumbnail ?? existingPreset.thumbnail,
        existingPreset.scope ?? 'project',
        existingPreset.id,
      );

      update((project) => ({
        ...project,
        stagePresets: (project.stagePresets || []).map(p =>
          p.id === presetId
            ? {
                ...snapshot,
                createdAt: p.createdAt,
                updatedAt: Date.now(),
              }
            : p
        ),
      }));
    },

    // ========== SV Keyboard Presets ==========

    // ========== WLED controllers ==========
    // Each controller is a WLED LED device on the LAN that the
    // renderer pushes per-frame pixel data to via UDP.
    addWLEDController(controller: WLEDController) {
      update((project) => ({
        ...project,
        wledControllers: [...(project.wledControllers || []), controller],
      }));
    },
    removeWLEDController(controllerId: string) {
      update((project) => ({
        ...project,
        wledControllers: (project.wledControllers || []).filter(c => c.id !== controllerId),
      }));
    },
    updateWLEDController(controllerId: string, fields: Partial<WLEDController>) {
      update((project) => ({
        ...project,
        wledControllers: (project.wledControllers || []).map(c =>
          c.id === controllerId ? { ...c, ...fields, id: controllerId } : c
        ),
      }));
    },
    addWLEDGroup(group: WLEDGroup) {
      update((project) => ({
        ...project,
        wledGroups: [...(project.wledGroups || []), group],
      }));
    },
    updateWLEDGroup(groupId: string, fields: Partial<WLEDGroup>) {
      update((project) => ({
        ...project,
        wledGroups: (project.wledGroups || []).map(group =>
          group.id === groupId ? { ...group, ...fields, id: groupId } : group
        ),
      }));
    },
    removeWLEDGroup(groupId: string) {
      update((project) => ({
        ...project,
        wledGroups: (project.wledGroups || []).filter(group => group.id !== groupId),
        wledEffects: (project.wledEffects || []).map(effect =>
          effect.target.mode === 'group' && effect.target.groupId === groupId
            ? { ...effect, target: { mode: 'all' as const } }
            : effect
        ),
      }));
    },
    addWLEDEffect(effect: WLEDEffect) {
      update((project) => ({
        ...project,
        wledEffects: [...(project.wledEffects || []), effect],
      }));
    },
    updateWLEDEffect(effectId: string, fields: Partial<WLEDEffect>) {
      update((project) => ({
        ...project,
        wledEffects: (project.wledEffects || []).map(effect =>
          effect.id === effectId ? { ...effect, ...fields, id: effectId } : effect
        ),
      }));
    },
    removeWLEDEffect(effectId: string) {
      update((project) => ({
        ...project,
        wledEffects: (project.wledEffects || []).filter(effect => effect.id !== effectId),
      }));
    },
    updateWLEDEffectAutomation(fields: Partial<WLEDEffectAutomation>) {
      update((project) => ({
        ...project,
        wledEffectAutomation: {
          playing: false,
          mode: 'beat',
          beats: 8,
          seconds: 4,
          order: 'forward',
          ...(project.wledEffectAutomation ?? {}),
          ...fields,
        },
      }));
    },

    saveSVKeyboardPreset(preset: SVKeyboardPreset) {
      update((project) => ({
        ...project,
        svKeyboardPresets: [...(project.svKeyboardPresets || []), preset],
      }));
    },

    deleteSVKeyboardPreset(presetId: string) {
      update((project) => ({
        ...project,
        svKeyboardPresets: (project.svKeyboardPresets || []).filter(p => p.id !== presetId),
      }));
    },

    renameSVKeyboardPreset(presetId: string, newName: string) {
      update((project) => ({
        ...project,
        svKeyboardPresets: (project.svKeyboardPresets || []).map(p =>
          p.id === presetId ? { ...p, name: newName } : p
        ),
      }));
    },

    /** Overwrite an existing SV keyboard preset's contents (clipAssignments,
     * etc.) with new values. Caller passes the new fields; id/name/scope
     * are preserved. Used by right-click "Update Preset" so users can
     * iterate on a preset without delete + re-save. */
    updateSVKeyboardPreset(presetId: string, fields: Partial<SVKeyboardPreset>) {
      update((project) => ({
        ...project,
        svKeyboardPresets: (project.svKeyboardPresets || []).map(p =>
          p.id === presetId ? { ...p, ...fields, id: presetId, name: p.name } : p
        ),
      }));
    },

    // ========== Import Presets from Another .ghost-arcade File ==========

    importPresetsFromFile(data: unknown): { stagePresets: StagePreset[]; svKeyboardPresets: SVKeyboardPreset[] } | null {
      try {
        const parsed = data as { project?: { stagePresets?: StagePreset[]; svKeyboardPresets?: SVKeyboardPreset[] } };
        if (!parsed.project) return null;
        return {
          stagePresets: (parsed.project.stagePresets || []).map(p => ({
            ...p,
            id: generateUUID(), // Re-ID to avoid collisions
            scope: 'project' as const,
          })),
          svKeyboardPresets: (parsed.project.svKeyboardPresets || []).map(p => ({
            ...p,
            id: generateUUID(),
            scope: 'project' as const,
          })),
        };
      } catch {
        return null;
      }
    },

    mergeImportedPresets(presets: { stagePresets: StagePreset[]; svKeyboardPresets: SVKeyboardPreset[] }) {
      update((project) => ({
        ...project,
        stagePresets: [...(project.stagePresets || []), ...presets.stagePresets],
        svKeyboardPresets: [...(project.svKeyboardPresets || []), ...presets.svKeyboardPresets],
      }));
    },

    /**
     * Export all presets (stage + keyboard) as a standalone JSON string.
     * Format is compatible with importPresetsFromFile — wrapped in a { project: ... }
     * envelope so it can be loaded by Import Presets.
     */
    exportPresetsJSON(): string {
      const p = get({ subscribe });
      return JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        type: 'ill-presets',
        project: {
          stagePresets: p.stagePresets || [],
          svKeyboardPresets: p.svKeyboardPresets || [],
        },
      }, null, 2);
    },

    toggleEffect(layerId: string, effectId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            effects: l.effects.map((e) =>
              e.id === effectId ? { ...e, enabled: !e.enabled } : e
            ),
          };
        }),
      }));
    },

    reorderEffects(layerId: string, fromIndex: number, toIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId) return l;
          const newEffects = [...l.effects];
          const [moved] = newEffects.splice(fromIndex, 1);
          newEffects.splice(toIndex, 0, moved);
          return { ...l, effects: newEffects };
        }),
      }));
    },

    // ============================================================================
    // LINES LAYER ELEMENT MANAGEMENT
    // ============================================================================

    addLineElement(layerId: string, shape: LineShape) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;

          const element = createLineElement(shape);
          element.zIndex = l.linesContent.elements.length;

          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: [...l.linesContent.elements, element],
              selectedElementId: element.id,
            },
          };
        }),
      }));
    },

    addLineElementDirect(layerId: string, element: LineElement) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;

          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: [...l.linesContent.elements, element],
              selectedElementId: element.id,
            },
          };
        }),
      }));
    },

    removeElement(layerId: string, elementId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.filter((e) => e.id !== elementId),
              selectedElementId: l.linesContent.selectedElementId === elementId
                ? null : l.linesContent.selectedElementId,
            },
          };
        }),
      }));
    },

    selectElement(layerId: string, elementId: string | null) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              selectedElementId: elementId,
            },
          };
        }),
      }));
    },

    updateElement(layerId: string, elementId: string, updates: Partial<LineElement>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) =>
                e.id === elementId ? { ...e, ...updates } : e
              ),
            },
          };
        }),
      }));
    },

    updateElementShape(layerId: string, elementId: string, shapeUpdates: Partial<LineShape> & Record<string, any>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          // Separate element-level props (position, rotation, scale) from shape-level props
          const { position, rotation, scale, ...shapeOnly } = shapeUpdates;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) => {
                if (e.id !== elementId) return e;
                const updated = { ...e };
                if (Object.keys(shapeOnly).length > 0) {
                  updated.shape = { ...e.shape, ...shapeOnly } as LineShape;
                }
                if (position !== undefined) updated.position = position;
                if (rotation !== undefined) updated.rotation = rotation;
                if (scale !== undefined) updated.scale = scale;
                return updated;
              }),
            },
          };
        }),
      }));
    },

    updateElementStroke(layerId: string, elementId: string, stroke: LineStroke | any) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) =>
                e.id === elementId ? { ...e, stroke } : e
              ),
            },
          };
        }),
      }));
    },

    // Compatibility aliases for DrawingPanel (maps old drawing API to lines API)
    addElement(layerId: string, _shapeType: string) {
      // DrawingPanel calls addElement(layerId, shapeType) — create a default freehand line
      const shape: LineShape = { type: 'freehand', points: [{ x: 0.5, y: 0.5 }], smoothing: 0.5 };
      this.addLineElement(layerId, shape);
    },

    updateElementFill(layerId: string, elementId: string, fill: any) {
      // Lines don't have fills — map fill color to stroke color if applicable
      if (fill?.color) {
        this.updateElement(layerId, elementId, {} as any);
      }
    },

    updateElementAnimation(layerId: string, elementId: string, animation: any) {
      // Map old Animation type to LineDrawAnimation
      this.updateElementDrawAnimation(layerId, elementId, animation as Partial<LineDrawAnimation>);
    },

    updateElementDrawAnimation(layerId: string, elementId: string, updates: Partial<LineDrawAnimation>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) =>
                e.id === elementId
                  ? { ...e, drawAnimation: { ...e.drawAnimation, ...updates } }
                  : e
              ),
            },
          };
        }),
      }));
    },

    duplicateElement(layerId: string, elementId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;

          const element = l.linesContent.elements.find((e) => e.id === elementId);
          if (!element) return l;

          const newElement: LineElement = {
            ...structuredClone(element),
            id: generateUUID(),
            name: `${element.name} Copy`,
            position: {
              x: element.position.x + 0.05,
              y: element.position.y + 0.05,
            },
            zIndex: l.linesContent.elements.length,
          };

          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: [...l.linesContent.elements, newElement],
              selectedElementId: newElement.id,
            },
          };
        }),
      }));
    },

    reorderElements(layerId: string, fromIndex: number, toIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          const elements = [...l.linesContent.elements];
          const [moved] = elements.splice(fromIndex, 1);
          elements.splice(toIndex, 0, moved);
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements,
            },
          };
        }),
      }));
    },

    // Per-element mesh warp methods
    setElementMeshWarpEnabled(layerId: string, elementId: string, enabled: boolean) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) =>
                e.id === elementId ? { ...e, meshWarpEnabled: enabled } : e
              ),
            },
          };
        }),
      }));
    },

    setElementMeshWarpPoint(layerId: string, elementId: string, row: number, col: number, position: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) => {
                if (e.id !== elementId || !e.meshWarp) return e;
                const newPoints = e.meshWarp.points.map((r, ri) =>
                  r.map((p, ci) => (ri === row && ci === col ? position : p))
                );
                return {
                  ...e,
                  meshWarp: { ...e.meshWarp, points: newPoints },
                };
              }),
            },
          };
        }),
      }));
    },

    setElementMeshWarpGridSize(layerId: string, elementId: string, rows: number, cols: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) =>
                e.id === elementId
                  ? { ...e, meshWarp: createDefaultShapeMesh(rows, cols) }
                  : e
              ),
            },
          };
        }),
      }));
    },

    resetElementMeshWarp(layerId: string, elementId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'lines' || !l.linesContent) return l;
          return {
            ...l,
            linesContent: {
              ...l.linesContent,
              elements: l.linesContent.elements.map((e) => {
                if (e.id !== elementId || !e.meshWarp) return e;
                return {
                  ...e,
                  meshWarp: createDefaultShapeMesh(e.meshWarp.rows, e.meshWarp.cols),
                };
              }),
            },
          };
        }),
      }));
    },

    // ============================================================================
    // SVG LAYER CONTENT MANAGEMENT
    // ============================================================================

    setSVGSource(layerId: string, svgSource: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, svgSource },
          };
        }),
      }));
    },

    updateSVGContent(layerId: string, updates: Partial<SVGContent>) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, ...updates },
          };
        }),
      }));
    },

    setSVGFillMode(layerId: string, fillMode: SVGFillMode) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, fillMode },
          };
        }),
      }));
    },

    setSVGColorMode(layerId: string, colorMode: SVGColorMode) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, colorMode },
          };
        }),
      }));
    },

    toggleSVGEffect(layerId: string, effectKey: keyof SVGContent) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          const currentValue = l.svgContent[effectKey];
          if (typeof currentValue !== 'boolean') return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, [effectKey]: !currentValue },
          };
        }),
      }));
    },

    setSVGParam(layerId: string, paramKey: keyof SVGContent, value: number | boolean | string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg' || !l.svgContent) return l;
          return {
            ...l,
            svgContent: { ...l.svgContent, [paramKey]: value },
          };
        }),
      }));
    },

    resetSVGContent(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((l) => {
          if (l.id !== layerId || l.type !== 'svg') return l;
          const svgSource = l.svgContent?.svgSource || '';
          return {
            ...l,
            svgContent: { ...createDefaultSVGContent(), svgSource },
          };
        }),
      }));
    },

    // ============================================================================
    // VJ MODE MANAGEMENT
    // ============================================================================

    /**
     * Initialize VJ Mode for the project
     */
    initVJMode() {
      update((project) => ({
        ...project,
        vjMode: project.vjMode || createDefaultVJModeState(),
      }));
    },

    /**
     * Toggle VJ Mode enabled state
     */
    toggleVJMode() {
      update((project) => {
        if (!project.vjMode) {
          return { ...project, vjMode: createDefaultVJModeState() };
        }
        return {
          ...project,
          vjMode: { ...project.vjMode, enabled: !project.vjMode.enabled },
        };
      });
    },

    /**
     * Save current layer state as a new composition
     */
    saveComposition(name: string, thumbnail?: string): string {
      const currentProject = get({ subscribe });
      const compositionId = generateUUID();

      console.log('[Store] saveComposition called, layers count:', currentProject.layers.length);

      // Deep clone layers, stripping runtime data BEFORE cloning to avoid structuredClone errors
      const layersSnapshot: Layer[] = [];
      for (const layer of currentProject.layers) {
        try {
          // Create a clean copy without non-cloneable objects
          const cleanLayer = JSON.parse(JSON.stringify(layer, (key, value) => {
            // Strip texture and video element (these can't be serialized)
            if (key === 'texture' || key === 'videoElement') {
              return undefined;
            }
            // Also strip any Three.js objects
            if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) {
              return undefined;
            }
            return value;
          }));
          layersSnapshot.push(cleanLayer);
        } catch (e) {
          console.warn('[Store] Failed to clone layer:', layer.id, e);
        }
      }

      console.log('[Store] Cloned layers count:', layersSnapshot.length);

      // Get Performer state snapshot
      const synthVisionSnapshot = synthVisionStore.getSerializable();

      // Capture transport sub-store snapshots so the preset can resume
      // playback on load when it was actively playing at save time.
      // Sub-store snapshots round-trip through JSON to strip any
      // accidental non-serializable bits (defensive — both serializers
      // already exclude runtime fields, but presets get embedded inside
      // project saves so an exotic ref would brick the whole file).
      const seqState = get(layerSequencer);
      const sequencerSnap = {
        snapshot: JSON.parse(JSON.stringify(layerSequencer.serialize())),
        wasPlaying: !!seqState.isPlaying,
      };
      const kfState = get(keyframeTimeline);
      const keyframesSnap = {
        snapshot: JSON.parse(JSON.stringify(keyframeTimeline.exportAll())),
        wasPlaying: !!kfState.config.isPlaying,
      };

      const composition: Composition = {
        id: compositionId,
        name,
        thumbnail,
        createdAt: Date.now(),
        layers: layersSnapshot,
        synthVision: synthVisionSnapshot,
        sequencer: sequencerSnap,
        keyframes: keyframesSnap,
      };

      console.log('[Store] Created composition:', composition.id, composition.name, 'with Performer state');

      update((project) => {
        const vjMode = project.vjMode || createDefaultVJModeState();
        const newCompositions = [...vjMode.compositions, composition];
        console.log('[Store] Updating vjMode, compositions count:', newCompositions.length);
        return {
          ...project,
          vjMode: {
            ...vjMode,
            compositions: newCompositions,
          },
        };
      });

      return compositionId;
    },

    /**
     * Update an existing composition in place with the current project
     * state. Mirrors saveComposition's snapshot logic (layers + sub-store
     * snapshots + Performer state + thumbnail) but writes back to the
     * existing composition id — so right-click → Update and the
     * "Update current" button overwrite rather than spawn a new entry.
     * Preserves createdAt and the existing name unless overridden.
     */
    updateComposition(compositionId: string, opts?: { thumbnail?: string; name?: string }): boolean {
      const currentProject = get({ subscribe });
      if (!currentProject.vjMode) return false;
      const existing = currentProject.vjMode.compositions.find(c => c.id === compositionId);
      if (!existing) {
        console.warn('[Store] updateComposition: no composition with id', compositionId);
        return false;
      }

      // Reuse the same sanitize-then-clone path as saveComposition so we
      // don't leak THREE/runtime refs into the saved tree.
      const layersSnapshot: Layer[] = [];
      for (const layer of currentProject.layers) {
        try {
          const cleanLayer = JSON.parse(JSON.stringify(layer, (key, value) => {
            if (key === 'texture' || key === 'videoElement') return undefined;
            if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) return undefined;
            return value;
          }));
          layersSnapshot.push(cleanLayer);
        } catch (e) {
          console.warn('[Store] updateComposition: failed to clone layer', layer.id, e);
        }
      }

      const synthVisionSnapshot = synthVisionStore.getSerializable();
      const seqState = get(layerSequencer);
      const sequencerSnap = {
        snapshot: JSON.parse(JSON.stringify(layerSequencer.serialize())),
        wasPlaying: !!seqState.isPlaying,
      };
      const kfState = get(keyframeTimeline);
      const keyframesSnap = {
        snapshot: JSON.parse(JSON.stringify(keyframeTimeline.exportAll())),
        wasPlaying: !!kfState.config.isPlaying,
      };

      const updated: Composition = {
        ...existing,
        name: opts?.name ?? existing.name,
        thumbnail: opts?.thumbnail ?? existing.thumbnail,
        // createdAt intentionally preserved — that's the original creation
        // timestamp, not "last updated".
        layers: layersSnapshot,
        synthVision: synthVisionSnapshot,
        sequencer: sequencerSnap,
        keyframes: keyframesSnap,
      };

      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            compositions: project.vjMode.compositions.map(c =>
              c.id === compositionId ? updated : c
            ),
          },
        };
      });
      console.log('[Store] updateComposition: overwrote', compositionId, updated.name);
      return true;
    },

    /**
     * Delete a composition
     */
    deleteComposition(compositionId: string) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            compositions: project.vjMode.compositions.filter(c => c.id !== compositionId),
            // Also remove from any decks using this composition
            decks: project.vjMode.decks.map(deck =>
              deck.compositionId === compositionId
                ? { ...deck, compositionId: null, isActive: false }
                : deck
            ),
            // Remove from timeline
            timeline: {
              ...project.vjMode.timeline,
              clips: project.vjMode.timeline.clips.filter(c => c.compositionId !== compositionId),
            },
          },
        };
      });
    },

    /**
     * Rename a composition
     */
    renameComposition(compositionId: string, newName: string) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            compositions: project.vjMode.compositions.map(c =>
              c.id === compositionId ? { ...c, name: newName } : c
            ),
          },
        };
      });
    },

    reorderComposition(fromIndex: number, toIndex: number) {
      update((project) => {
        if (!project.vjMode) return project;
        const comps = project.vjMode.compositions || [];
        if (fromIndex < 0 || fromIndex >= comps.length) return project;
        if (toIndex < 0 || toIndex >= comps.length) return project;
        if (fromIndex === toIndex) return project;
        const nextCompositions = [...comps];
        const [moved] = nextCompositions.splice(fromIndex, 1);
        nextCompositions.splice(toIndex, 0, moved);
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            compositions: nextCompositions,
          },
        };
      });
    },

    /**
     * Update composition thumbnail
     */
    updateCompositionThumbnail(compositionId: string, thumbnail: string) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            compositions: project.vjMode.compositions.map(c =>
              c.id === compositionId ? { ...c, thumbnail } : c
            ),
          },
        };
      });
    },

    /**
     * Load a composition into the main layers (for editing/preview)
     *
     * `options.restoreTransports` (default TRUE — today's behaviour for every
     * existing caller) controls the deferred sub-transport restart below.
     * Set it FALSE when something else owns the clock: an offline export
     * seeks keyframeTimeline / layerSequencer itself once per frame, and the
     * `queueMicrotask` here lands a microtask later and would re-zero both
     * out from under the render loop. The show timeline passes false while
     * a render owns the clock. See stores/showTimeline.ts.
     */
    loadComposition(compositionId: string, options?: { restoreTransports?: boolean }) {
      const restoreTransports = options?.restoreTransports !== false;
      // First get the composition to access Performer data
      const currentProject = get({ subscribe });
      if (!currentProject.vjMode) return;
      const composition = currentProject.vjMode.compositions.find(c => c.id === compositionId);
      if (!composition) return;

      // Load Performer state if present
      if (composition.synthVision) {
        synthVisionStore.loadSerializable(composition.synthVision);
        console.log('[Store] Loaded Performer state from composition');
      }

      update((project) => {
        if (!project.vjMode) return project;

        // Deep clone the composition's layers
        const loadedLayers = structuredClone(composition.layers);
        loadedLayers.forEach((layer) => {
          if (isVideoSource(layer.source)) {
            rehydrateVideoSource(layer.source);
          }
        });

        return {
          ...project,
          layers: loadedLayers,
          vjMode: {
            ...project.vjMode,
            activeCompositionId: compositionId,
          },
        };
      });

      // Transport sub-stores: restore pattern + tracks; if the snapshot
      // was actively playing, reset playhead to 0 and auto-start.
      // Deferred via queueMicrotask so the layer-swap above flushes
      // first — otherwise the sequencer/keyframe tick reads the old
      // layer set on its first iteration.
      const { sequencer: seqSnap, keyframes: kfSnap } = composition;
      if (seqSnap || kfSnap) {
        queueMicrotask(() => {
          if (seqSnap?.snapshot) {
            layerSequencer.hydrate(seqSnap.snapshot);
            if (seqSnap.wasPlaying && restoreTransports) {
              // stop() resets currentStep=0 and clears overrides; play()
              // kicks the RAF loop. Reset-then-play matches the user's
              // "predictable, always starts clean" choice.
              layerSequencer.stop();
              layerSequencer.play();
            }
          }
          if (kfSnap?.snapshot) {
            keyframeTimeline.importAll(kfSnap.snapshot);
            if (kfSnap.wasPlaying && restoreTransports) {
              // seek(0) rewinds the playhead and re-evaluates overrides
              // WITHOUT wiping the timelines we just imported. Earlier
              // this called reset(), which calls set(createInitialState())
              // and blew away the tracks — bug noticed on the first
              // preset-with-keyframes load.
              keyframeTimeline.seek(0);
              keyframeTimeline.play();
            }
          }
        });
      }
    },

    /**
     * Assign a composition to a VJ deck
     */
    assignToDeck(deckId: string, compositionId: string | null) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            decks: project.vjMode.decks.map(deck =>
              deck.id === deckId
                ? { ...deck, compositionId, isActive: compositionId !== null }
                : deck
            ),
          },
        };
      });
    },

    /**
     * Set deck opacity
     */
    setDeckOpacity(deckId: string, opacity: number) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            decks: project.vjMode.decks.map(deck =>
              deck.id === deckId ? { ...deck, opacity: Math.max(0, Math.min(1, opacity)) } : deck
            ),
          },
        };
      });
    },

    /**
     * Set deck blend mode
     */
    setDeckBlendMode(deckId: string, blendMode: BlendMode) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            decks: project.vjMode.decks.map(deck =>
              deck.id === deckId ? { ...deck, blendMode } : deck
            ),
          },
        };
      });
    },

    /**
     * Toggle deck active state
     */
    toggleDeckActive(deckId: string) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            decks: project.vjMode.decks.map(deck =>
              deck.id === deckId ? { ...deck, isActive: !deck.isActive } : deck
            ),
          },
        };
      });
    },

    /**
     * Set master opacity
     */
    setMasterOpacity(opacity: number) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            masterOpacity: Math.max(0, Math.min(1, opacity)),
          },
        };
      });
    },

    // ============================================================================
    // TIMELINE MANAGEMENT
    // ============================================================================

    /**
     * Add a clip to the timeline
     */
    addTimelineClip(compositionId: string, duration: number = 5) {
      update((project) => {
        if (!project.vjMode) return project;

        const timeline = project.vjMode.timeline;
        const lastClip = timeline.clips[timeline.clips.length - 1];
        const startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;

        const newClip: TimelineClip = {
          id: generateUUID(),
          compositionId,
          startTime,
          duration,
          transitionIn: 'cut',
          transitionDuration: 0.5,
        };

        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...timeline,
              clips: [...timeline.clips, newClip],
              totalDuration: startTime + duration,
            },
          },
        };
      });
    },

    /**
     * Remove a clip from the timeline
     */
    removeTimelineClip(clipId: string) {
      update((project) => {
        if (!project.vjMode) return project;

        const newClips = project.vjMode.timeline.clips.filter(c => c.id !== clipId);

        // Recalculate start times and total duration
        let currentTime = 0;
        const recalculatedClips = newClips.map(clip => {
          const newClip = { ...clip, startTime: currentTime };
          currentTime += clip.duration;
          return newClip;
        });

        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              clips: recalculatedClips,
              totalDuration: currentTime,
            },
          },
        };
      });
    },

    /**
     * Update a timeline clip
     */
    updateTimelineClip(clipId: string, updates: Partial<TimelineClip>) {
      update((project) => {
        if (!project.vjMode) return project;

        const newClips = project.vjMode.timeline.clips.map(clip =>
          clip.id === clipId ? { ...clip, ...updates } : clip
        );

        // Recalculate start times if duration changed
        let currentTime = 0;
        const recalculatedClips = newClips.map(clip => {
          const newClip = { ...clip, startTime: currentTime };
          currentTime += clip.duration;
          return newClip;
        });

        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              clips: recalculatedClips,
              totalDuration: currentTime,
            },
          },
        };
      });
    },

    /**
     * Reorder timeline clips
     */
    reorderTimelineClips(fromIndex: number, toIndex: number) {
      update((project) => {
        if (!project.vjMode) return project;

        const newClips = [...project.vjMode.timeline.clips];
        const [moved] = newClips.splice(fromIndex, 1);
        newClips.splice(toIndex, 0, moved);

        // Recalculate start times
        let currentTime = 0;
        const recalculatedClips = newClips.map(clip => {
          const newClip = { ...clip, startTime: currentTime };
          currentTime += clip.duration;
          return newClip;
        });

        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              clips: recalculatedClips,
              totalDuration: currentTime,
            },
          },
        };
      });
    },

    /**
     * Toggle timeline loop
     */
    toggleTimelineLoop() {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              loop: !project.vjMode.timeline.loop,
            },
          },
        };
      });
    },

    /**
     * Set timeline playing state
     */
    setTimelinePlaying(isPlaying: boolean) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              isPlaying,
            },
          },
        };
      });
    },

    /**
     * Set timeline current time
     */
    setTimelineCurrentTime(currentTime: number) {
      update((project) => {
        if (!project.vjMode) return project;
        return {
          ...project,
          vjMode: {
            ...project.vjMode,
            timeline: {
              ...project.vjMode.timeline,
              currentTime,
            },
          },
        };
      });
    },

    // Project management
    newProject(name: string = 'Untitled Project') {
      set(createProject(name));
    },

    setProjectDimensions(width: number, height: number) {
      update((project) => ({ ...project, width, height }));
    },

    setProjectName(name: string) {
      update((project) => ({ ...project, name }));
    },

    setMediaFolders(folders: MediaTrayFolder[]) {
      update((project) => ({
        ...project,
        mediaFolders: normalizeMediaTrayFolders(folders),
      }));
    },

    // ============================================================================
    // SAVE / LOAD COMPOSITION
    // ============================================================================

    /**
     * Helper to strip non-serializable data from a layer for export
     */
    _exportLayer(layer: Layer): Record<string, unknown> {
      const exportLayer: Record<string, unknown> = {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        position: layer.position,
        scale: layer.scale,
        rotation: layer.rotation,
        flipH: layer.flipH,
        flipV: layer.flipV,
        corners: layer.corners,
        warpMode: layer.warpMode,
        meshGrid: layer.meshGrid,
        mask: layer.mask,
        cropRegion: layer.cropRegion,
        layerShape: layer.layerShape,
        effects: layer.effects,
        edgeEffects: layer.edgeEffects,
        vjLayerIndex: layer.vjLayerIndex,
        contentFit: layer.contentFit,
        renderQuality: layer.renderQuality,
        parentGroupId: layer.parentGroupId,
        groupConfig: layer.groupConfig,
        groupCollapsed: layer.groupCollapsed,
      };

      // Handle media source - strip texture and video element. Carry
      // `_assetRef` so reload can recover the original disk file even if
      // the runtime `src` is a dead blob: URL by then.
      if (layer.source) {
        exportLayer.source = {
          id: layer.source.id,
          type: layer.source.type,
          src: layer.source.src,
          name: layer.source.name,
          shaderCode: layer.source.shaderCode,
          shaderInputs: layer.source.shaderInputs,
          shaderValues: layer.source.shaderValues,
          shaderImageInputs: layer.source.shaderImageInputs,
          spoutSource: layer.source.spoutSource,
          effectSource: layer.source.effectSource,
          jsAnimation: layer.source.jsAnimation,
          aiGenerated: layer.source.aiGenerated,
          aiPrompt: layer.source.aiPrompt,
          playbackMode: layer.source.playbackMode,
          playbackRate: layer.source.playbackRate,
          trimStart: (layer.source as any).trimStart,
          trimEnd: (layer.source as any).trimEnd,
          // Opt-in audio playback for mapping-mode media layers. Absent on
          // every project saved before this feature; imports back as false.
          audioPlayback: (layer.source as any).audioPlayback,
          audioVolume: (layer.source as any).audioVolume,
          audioMuted: (layer.source as any).audioMuted,
          timelapseInterval: layer.source.timelapseInterval,
          timelapseRunning: layer.source.timelapseRunning,
          _assetRef: (layer.source as any)._assetRef,
          // Exclude: texture, videoElement, isPlaying, iframeElement, threejsCanvas, synthVisionCanvas
        };
      }

      // Handle lines content
      if (layer.linesContent) {
        exportLayer.linesContent = layer.linesContent;
      }

      // Handle SVG content
      if (layer.svgContent) {
        exportLayer.svgContent = layer.svgContent;
      }

      // Handle color content
      if (layer.colorContent) {
        exportLayer.colorContent = layer.colorContent;
      }

      // Handle light painting content
      if (layer.lightPaintingContent) {
        exportLayer.lightPaintingContent = layer.lightPaintingContent;
      }
      if ((layer as any).advLightPaintingContent) {
        (exportLayer as any).advLightPaintingContent = (layer as any).advLightPaintingContent;
      }

      // Handle text content
      if (layer.textContent) {
        exportLayer.textContent = layer.textContent;
      }

      // Handle splat content (point cloud / gaussian splat). Spread preserves
      // `_assetRef` and `_textureAssetRef` — those are the durable identity
      // for save/reload now, so we no longer null out blob URLs (the
      // resolver consults the assetRef first and only falls back to the
      // runtime URL field for legacy projects).
      if (layer.splatContent) {
        const sc: any = { ...layer.splatContent };
        // Strip the runtime three.js refs that don't survive JSON.
        delete sc.texture;
        delete sc.videoTextureElement;
        exportLayer.splatContent = sc;
      }

      // Handle model3d content. Same story — assetRef carries the truth,
      // so we only strip runtime refs.
      if (layer.model3dContent) {
        const mc: any = { ...layer.model3dContent };
        delete mc.scene;
        delete mc.mixer;
        exportLayer.model3dContent = mc;
      }

      // PixelFX layer content — was missing from the export entirely, which
      // meant reopening a project lost every pixel-fx layer's source picker
      // state, knob values, particle count, etc. Spread to keep the
      // `_sourceAssetRef` durable identity along with the regular params.
      if ((layer as any).pixelFXContent) {
        const px: any = { ...(layer as any).pixelFXContent };
        // No runtime objects on this content type; spread is safe.
        exportLayer.pixelFXContent = px;
      }

      // GPU layer (compute shader / fluid sim / particles) — same omission.
      // The `params` blob holds the user's per-shader knob state and source
      // assignments; without it the layer comes back with default params on
      // every reload.
      if ((layer as any).gpuLayerContent) {
        const gp: any = { ...(layer as any).gpuLayerContent };
        exportLayer.gpuLayerContent = gp;
      }

      // _importLayer restores this, so not exporting it meant an arcade layer
      // came back empty from its own save file.
      if ((layer as any).arcadeContent) {
        exportLayer.arcadeContent = (layer as any).arcadeContent;
      }

      /*
       * Stage Designer's texture-orientation marker. Dropping it left reload
       * relying on stageTextureNeedsVerticalFlip's corner-geometry fallback --
       * which was written for pre-flag saves, and infers the wrong answer once
       * the user flips or re-corners a mapped surface.
       */
      if (typeof (layer as any).stageTextureFlipV === 'boolean') {
        exportLayer.stageTextureFlipV = (layer as any).stageTextureFlipV;
      }

      return exportLayer;
    },

    /**
     * Async variant of _exportLayer that embeds blob URLs as data URLs
     * for persistent file saves. Falls back gracefully if conversion fails.
     */
    async _exportLayerForSave(layer: Layer): Promise<Record<string, unknown>> {
      const exported = this._exportLayer(layer);

      // For each blob-URL field, prefer the AssetRef path — materializeAssets
      // ${...} in App.svelte will copy the file alongside the .gha via the
      // captured originalPath, which is orders of magnitude faster than
      // base64-ing a multi-GB video into the JSON. Only fall back to
      // base64 embedding for legacy nodes that lack an assetRef.

      if (layer.model3dContent?.modelData?.startsWith('blob:')
          && !(layer.model3dContent as any)._assetRef) {
        try {
          const dataUrl = await blobUrlToDataUrl(layer.model3dContent.modelData);
          if (dataUrl && exported.model3dContent) {
            (exported.model3dContent as any).modelData = dataUrl;
          }
        } catch (e) {
          console.warn('[exportLayerForSave] Failed to embed model data:', e);
        }
      }

      if (layer.splatContent?.filePath?.startsWith('blob:')
          && !(layer.splatContent as any)._assetRef) {
        try {
          const dataUrl = await blobUrlToDataUrl(layer.splatContent.filePath);
          if (dataUrl && exported.splatContent) {
            (exported.splatContent as any).filePath = dataUrl;
          }
        } catch (e) {
          console.warn('[exportLayerForSave] Failed to embed splat data:', e);
        }
      }

      if (layer.splatContent?.texturePath?.startsWith('blob:')
          && !(layer.splatContent as any)._textureAssetRef) {
        try {
          const dataUrl = await blobUrlToDataUrl(layer.splatContent.texturePath);
          if (dataUrl && exported.splatContent) {
            (exported.splatContent as any).texturePath = dataUrl;
          }
        } catch (e) {
          console.warn('[exportLayerForSave] Failed to embed splat texture:', e);
        }
      }

      return exported;
    },

    /**
     * Export the current project as a JSON object suitable for saving.
     * Includes vjMode (presets) and media library.
     * Excludes runtime-only properties like textures and video elements.
     */
    exportProject(): object {
      const currentProject = get({ subscribe });
      const currentMedia = get(mediaLibrary);

      // Export vjMode with compositions (presets)
      let exportVjMode = null;
      if (currentProject.vjMode) {
        exportVjMode = {
          enabled: currentProject.vjMode.enabled,
          activeCompositionId: currentProject.vjMode.activeCompositionId,
          masterOpacity: currentProject.vjMode.masterOpacity,
          // Export compositions with stripped layer data
          compositions: currentProject.vjMode.compositions.map(comp => ({
            id: comp.id,
            name: comp.name,
            thumbnail: comp.thumbnail,
            createdAt: comp.createdAt,
            layers: comp.layers.map(layer => this._exportLayer(layer)),
            synthVision: comp.synthVision,
          })),
          // Export decks
          decks: currentProject.vjMode.decks.map(deck => ({
            id: deck.id,
            name: deck.name,
            compositionId: deck.compositionId,
            opacity: deck.opacity,
            volume: deck.volume,
            playbackSpeed: deck.playbackSpeed,
            isPlaying: deck.isPlaying,
            transitionType: deck.transitionType,
            transitionDuration: deck.transitionDuration,
          })),
          // Export timeline
          timeline: {
            clips: currentProject.vjMode.timeline.clips,
            loop: currentProject.vjMode.timeline.loop,
            totalDuration: currentProject.vjMode.timeline.totalDuration,
            isPlaying: false,
            currentTime: 0,
          },
        };
      }

      // Export media library (strip runtime objects). Carry `_assetRef` so
      // the library entries restore to the same disk file on reload — without
      // it the saved src is just a dead blob: URL.
      const exportMedia = currentMedia.map(item => ({
        id: item.id,
        name: item.name,
        src: item.src,
        type: item.type,
        thumbnail: item.thumbnail,
        _assetRef: (item as any)._assetRef,
        // Exclude: videoElement, texture
      }));

      // Export VJ Clip Launcher state (strip runtime objects like videoElement)
      const currentVjClipLauncher = get(vjClipLauncher);
      const exportClip = (clip: VJClip | null) => {
        if (!clip) return null;
        const recoveredAssetRef = recoverVJClipAssetRef(clip as any, currentMedia);
        if (
          !recoveredAssetRef &&
          (clip.type === 'video' || clip.type === 'image') &&
          clip.src?.startsWith('blob:')
        ) {
          console.warn(
            `[Project Save] VJ clip "${clip.name}" has only a session blob URL; ` +
            'it will require relinking after restart.',
          );
        }
        return {
          id: clip.id,
          type: clip.type,
          name: clip.name,
          src: clip.src,
          thumbnail: clip.thumbnail,
          shaderCode: clip.shaderCode,
          shaderValues: clip.shaderValues,
          playbackMode: clip.playbackMode,
          playbackRate: clip.playbackRate,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
          isPlaying: clip.isPlaying,
          // Opt-in clip audio. Carried so a saved show keeps whichever clips
          // the user chose to make audible; absent on every pre-existing
          // project file, which imports back as silent (default false).
          audioPlayback: clip.audioPlayback,
          audioVolume: clip.audioVolume,
          audioMuted: clip.audioMuted,
          zoom: clip.zoom,
          fit: clip.fit,
          anchorX: clip.anchorX,
          anchorY: clip.anchorY,
          rotation: clip.rotation,
          opacity: clip.opacity,
          spoutSource: clip.spoutSource,
          ndiSource: (clip as any).ndiSource,
          effectSource: clip.effectSource,
          jsAnimation: clip.jsAnimation,
          effects: clip.effects || [],
          // Splat / 3D model clips carry their content blob alongside the
          // top-level src — copy through so the assetRef on those nested
          // contents survives save/reload.
          splatContent: (clip as any).splatContent,
          model3dContent: (clip as any).model3dContent || (clip as any).model3DContent,
          // GPU shader and live-text clips keep ALL of their state in these
          // content objects — a `gpu` clip that loses gpuLayerContent reopens
          // as an empty cell, not merely an unresolved asset.
          gpuLayerContent: (clip as any).gpuLayerContent,
          textContent: (clip as any).textContent,
          // Preset clips fire a saved composition by id.
          presetId: (clip as any).presetId,
          shaderValueAuto: (clip as any).shaderValueAuto,
          mirrorX: (clip as any).mirrorX,
          playbackSyncBeats: (clip as any).playbackSyncBeats,
          durationSeconds: (clip as any).durationSeconds,
          _assetRef: recoveredAssetRef,
          // Exclude runtime objects: videoElement / iframeElement / synthVisionCanvas
        };
      };

      // Common per-layer-state serializer (used for both Bank A and Bank B)
      const exportLayerState = (ls: any) => ({
        opacity: ls.opacity,
        blendMode: ls.blendMode,
        solo: ls.solo,
        mute: ls.mute,
        activeColumn: ls.activeColumn,
        activeClip: exportClip(ls.activeClip),
        effects: ls.effects,
      });

      const exportVjClipLauncher = {
        numLayers: currentVjClipLauncher.numLayers,
        numColumns: currentVjClipLauncher.numColumns,
        // Each block now carries BOTH banks' grids — switching blocks swaps
        // both A and B together so a "block" is a self-contained A+B scene.
        blocks: currentVjClipLauncher.blocks.map(block => ({
          id: block.id,
          name: block.name,
          clipGrid: block.clipGrid.map(row =>
            row.map(clip => exportClip(clip))
          ),
          bankBClipGrid: (block.bankBClipGrid || []).map(row =>
            row.map(clip => exportClip(clip))
          ),
        })),
        activeBlockId: currentVjClipLauncher.activeBlockId,
        layerStates: currentVjClipLauncher.layerStates.map(exportLayerState),
        // Bank B per-layer state (opacity / blend / solo / mute / effects /
        // activeClip ref) is GLOBAL across blocks — same as Bank A's
        // layerStates. Only the clip grid lives inside the block.
        bankBLayerStates: (currentVjClipLauncher.bankBLayerStates || []).map(exportLayerState),
        // Crossfader state — preserved so the user re-opens to the same mix.
        crossfaderEnabled: !!currentVjClipLauncher.crossfaderEnabled,
        crossfaderValue: currentVjClipLauncher.crossfaderValue ?? 0,
        crossfaderTransition: currentVjClipLauncher.crossfaderTransition || 'dissolve',
        crossfaderCurve: currentVjClipLauncher.crossfaderCurve || 'constant-power',
        crossfaderBlendMode: currentVjClipLauncher.crossfaderBlendMode || 'normal',
        crossfaderFadeDuration: currentVjClipLauncher.crossfaderFadeDuration ?? 0,
        selectedDeck: currentVjClipLauncher.selectedDeck || 'A',
        // Launch quantization grid — pendingTriggers are session-only
        // (in-flight live state, not part of the project).
        quantization: currentVjClipLauncher.quantization || 'off',
        masterOpacity: currentVjClipLauncher.masterOpacity,
        isOpen: currentVjClipLauncher.isOpen,
        isLive: false, // Don't persist live state
        compositionEffects: currentVjClipLauncher.compositionEffects || [],
        stageMode: false, // Don't persist stage mode active state
        stagePresetId: currentVjClipLauncher.stagePresetId,
      };

      const exportModulations = Array.from(get(modulationStore).entries()).map(([key, mod]) => ({
        key,
        mod,
      }));

      // SynthVision PROJECT-ROOT state. Was previously only saved
      // INSIDE vjMode compositions, which meant any performer / world
      // / shader-param config the user set up while just working in
      // mapping mode was lost on save. Capture it at the top level so
      // it survives a project reopen even when no composition is set.
      const exportSynthVision = synthVisionStore.getSerializable();

      // User-tweakable audio settings. Most of audioStore's fields are
      // runtime FFT bins / beat phase that don't need to persist, but
      // these four carry the user's sound-board calibration:
      //   - sensitivity:  global gain across all bands
      //   - smoothing:    EMA factor on band-level updates
      //   - manualBPM:    set when the user overrode auto-detect
      //   - bandGain:     per-band EQ multipliers
      // Without persisting these, every project reopen reverts to
      // defaults and the user has to retune for their venue.
      const audioState = audioStore.getState();
      const exportAudio = {
        sensitivity: audioState.sensitivity,
        smoothing: audioState.smoothing,
        manualBPM: audioState.manualBPM,
        bandGain: audioState.bandGain,
      };

      // Deep clone and strip out non-serializable data
      const exportData = {
        // 1.9.5 = added project.showTimeline (mapping-mode show arrangement:
        //         audio tracks riding AssetRefs + preset clip lane). Save-only
        //         section, added by exportProjectJSON / exportProjectForSave —
        //         NOT by this sync export, same as stage3d / projectionSim.
        // 1.9.4 = project.projectionSim (Map Sim scene).
        // 1.9.3 = added layerSequencer (step sequencer pattern + config)
        //         and geoDeck (geo performer scenes + mod routes) at the
        //         project root. Older saves skip these on import and the
        //         stores stay at their initial state.
        // 1.9.1 = added project-root synthVision + audio settings
        //         (sensitivity / smoothing / manualBPM / bandGain).
        // 1.9.0 = added macros (8 knobs + destinations + pulse), snapshots
        //         (16-slot scene bank), and launch quantization (those live
        //         outside this vjClipLauncher payload but versioned together).
        // 1.8.0 = moved bankBClipGrid INSIDE each VJBlock.
        // 1.7.0 = added Bank B deck + crossfader state at launcher root.
        version: '1.9.5',
        exportedAt: new Date().toISOString(),
        project: {
          id: currentProject.id,
          name: currentProject.name,
          width: currentProject.width,
          height: currentProject.height,
          selectedLayerId: currentProject.selectedLayerId,
          layers: currentProject.layers.map(layer => this._exportLayer(layer)),
          mappingComposition: normalizeMappingCompositionState(currentProject.mappingComposition),
          vjMode: exportVjMode,
          mediaFolders: normalizeMediaTrayFolders(currentProject.mediaFolders),
          stagePresets: currentProject.stagePresets || [],
          svKeyboardPresets: currentProject.svKeyboardPresets || [],
          // Stage Designer surfaces — projection geometry layouts +
          // their slice→layer bindings. Persisted as plain JSON; no
          // runtime refs to strip.
          surfaces: currentProject.surfaces || [],
          activeSurfaceId: currentProject.activeSurfaceId ?? null,
          // Multi-output slices snapshot — saved with the project so
          // the operator's projector / display layout survives a
          // reload. Read live from $settings.output because that's
          // where the per-frame extractor consults; we mirror it
          // into Project on export so future loads can rehydrate it.
          outputSlices: get(settings).output?.slices ?? [],
          outputMasterCanvasWidth: get(settings).output?.masterCanvasWidth ?? 1920,
          outputMasterCanvasHeight: get(settings).output?.masterCanvasHeight ?? 1080,
          // Global master warp travels with the project so a venue's
          // keystone correction survives a reload / file handoff.
          outputMasterWarp: get(settings).output?.masterWarp ?? { enabled: false, mode: 'corners' },
        },
        // Include media library
        mediaLibrary: exportMedia,
        // Include VJ Clip Launcher state
        vjClipLauncher: exportVjClipLauncher,
        // Include parameter modulation assignments
        modulation: exportModulations,
        // Include keyframe timelines
        keyframeTimelines: keyframeTimeline.exportAll(),
        // Include macro knobs (8 user-assignable knobs with destinations)
        macros: macros.serialize(),
        // Include OSC config (port + bindings). The listener is
        // restarted on project load if the saved state was enabled.
        osc: oscStore.serialize(),
        // Include keyboard control bindings (key combo → param path).
        // Same router as MIDI/OSC, so the binding paths are identical.
        keyboard: keyboardStore.serialize(),
        // Include MediaPipe gesture bindings (camera → param routing).
        // Project-scoped so opening a different project doesn't carry
        // the previous one's hand mappings.
        mediaPipe: mediaPipeBus.serialize(),
        // Include snapshot bank (16 captured-state slots)
        snapshots: snapshots.serialize(),
        // Include SynthVision performer state at project root
        synthVision: exportSynthVision,
        // Include user-tweakable audio settings
        audio: exportAudio,
        // Include layer step sequencer (pattern + timing config). Was
        // missing — meant the user's sequencer pattern survived an in-app
        // session but was lost the moment they reopened the .gha.
        layerSequencer: layerSequencer.serialize(),
        // Include GeoDeck (geo performer) state — scene slots, modulation
        // routes, current form/sliders. Lives at project root because the
        // performer state is part of the composition the user is building.
        geoDeck: geoDeckStore.serialize(),
      };

      // NOTE: deliberately no `project.stage3d` here. This export feeds the
      // live state-sync relay, and importProject treats a present stage3d as
      // "restore this scene" — so including it made every sync tick reload a
      // stale snapshot over the Stage Sim, wiping the venue and any preset
      // the operator had just applied. Save and autosave add it themselves.
      return exportData;
    },

    /**
     * Export the project as a JSON string for autosave / download.
     * Unlike exportProject(), this DOES carry the Stage 3D scene — the live
     * sync relay uses exportProject() directly and must not.
     */
    exportProjectJSON(): string {
      const exportData = this.exportProject() as any;
      try {
        exportData.project.stage3d = JSON.parse(JSON.stringify(get(stage3dScene)));
      } catch { /* snapshot failed — autosave still carries the layers */ }
      try {
        exportData.project.projectionSim = projectionSimScene.exportForProject();
      } catch { /* ditto */ }
      try {
        // Same save-only treatment: the show timeline carries audio
        // AssetRefs and a whole arrangement, neither of which belongs on
        // the per-tick sync relay.
        exportData.project.showTimeline = showTimeline.serialize();
      } catch { /* ditto */ }
      return JSON.stringify(exportData, null, 2);
    },

    /**
     * Async export that embeds blob URLs as base64 data URLs.
     * Used for file saves (Ctrl+S, Save As) so 3D models, splat files,
     * and video textures survive across sessions.
     */
    async exportProjectForSave(): Promise<object> {
      const currentProject = get({ subscribe });
      // Start with the sync export (strips blob URLs)
      const syncExport = this.exportProject() as any;

      // Re-export main layers with embedded blob data
      syncExport.project.layers = await Promise.all(
        currentProject.layers.map(layer => this._exportLayerForSave(layer))
      );

      // Re-export VJ composition layers with embedded blob data
      if (currentProject.vjMode?.compositions) {
        const comps = syncExport.project.vjMode.compositions;
        for (let i = 0; i < currentProject.vjMode.compositions.length; i++) {
          const comp = currentProject.vjMode.compositions[i];
          if (comp.layers && comps[i]) {
            comps[i].layers = await Promise.all(
              comp.layers.map((layer: Layer) => this._exportLayerForSave(layer))
            );
          }
        }
      }

      // Keep in lockstep with exportProject() above.
      // 1.9.5 bump: project.showTimeline (mapping-mode show arrangement;
      // audio tracks ride AssetRefs, runtime URLs are blanked at save).
      // 1.9.4 bump: project.projectionSim (Map Sim scene; imported models
      // ride AssetRefs, runtime URLs are blanked at save).
      // 1.9.3 bump: layerSequencer + geoDeck now serialize at project root.
      // 1.9.2 bump: AssetRef capture on every File-import site, plus
      // pixelFXContent / gpuLayerContent now actually export. Older saves
      // (1.9.x and earlier) still load via the legacy resolveSrc fallback.
      syncExport.version = '1.9.5';
      try {
        syncExport.project.stage3d = JSON.parse(JSON.stringify(get(stage3dScene)));
      } catch (err) {
        console.warn('[Store] exportProjectForSave: 3D scene snapshot failed', err);
      }
      try {
        // Save-only, like stage3d: the live state-sync relay must not carry
        // scene payloads or every sync tick would clobber the open editor.
        syncExport.project.projectionSim = projectionSimScene.exportForProject();
      } catch (err) {
        console.warn('[Store] exportProjectForSave: projection sim snapshot failed', err);
      }
      try {
        // Save-only for the same two reasons: it holds audio AssetRefs, and
        // the save-path restore is the one that receives projectDir so those
        // refs can resolve against the .gha's own folder.
        syncExport.project.showTimeline = showTimeline.serialize();
      } catch (err) {
        console.warn('[Store] exportProjectForSave: show timeline snapshot failed', err);
      }
      return syncExport;
    },

    /**
     * Async JSON string export with embedded binary assets for file saves.
     */
    async exportProjectJSONForSave(): Promise<string> {
      const exportData = await this.exportProjectForSave();
      return JSON.stringify(exportData, null, 2);
    },

    /**
     * Helper to import a layer with proper defaults
     */
    _importLayer(layer: any): Layer {
      // Migrate old 'generative' type to 'lines'
      const migratedType = layer.type === 'generative' ? 'lines' : (layer.type || 'media');

      // Migrate legacy single-polygon mask shape (mask.points -> mask.shapes).
      // Old projects stored a flat `points: Point2D[]` representing ONE
      // polygon. New layout is `shapes: MaskShape[]` (union of bezier sub-
      // polygons). If we see the legacy field, fold it into a single closed
      // shape so the visual output is identical, then drop the legacy key.
      let migratedMask: import('../types').MaskConfig | null = layer.mask || null;
      if (migratedMask) {
        const m = migratedMask as any;
        if ('points' in m && !('shapes' in m)) {
          const legacyPoints: Point2D[] = Array.isArray(m.points) ? m.points : [];
          const newShapes: MaskShape[] = legacyPoints.length >= 3
            ? [{ points: legacyPoints.map((p) => ({ x: p.x, y: p.y })), closed: true }]
            : [];
          migratedMask = {
            enabled: !!m.enabled,
            inverted: !!m.inverted,
            feather: typeof m.feather === 'number' ? m.feather : 0,
            shapes: newShapes,
          };
        } else if (!Array.isArray((migratedMask as any).shapes)) {
          // Defensive: make sure shapes is always an array
          migratedMask = { ...migratedMask, shapes: [] };
        }
      }

      // Migrate generativeContent to linesContent
      let linesContent: LinesContent | null = null;
      if (layer.linesContent) {
        linesContent = layer.linesContent;
      } else if (layer.generativeContent) {
        // Legacy migration: convert generativeContent to linesContent
        const gc = layer.generativeContent;
        linesContent = {
          ...createDefaultLinesContent(),
          backgroundColor: gc.backgroundColor || [0, 0, 0, 0],
          selectedElementId: gc.selectedElementId || null,
          elements: [], // Old shape-based elements are not line-compatible; start empty
        };
      }

      return {
        id: layer.id || generateUUID(),
        name: layer.name || 'Layer',
        type: migratedType,
        visible: layer.visible !== undefined ? layer.visible : true,
        locked: layer.locked || false,
        opacity: layer.opacity !== undefined ? layer.opacity : 1,
        blendMode: layer.blendMode || 'normal',
        source: layer.source ? {
          ...layer.source,
          texture: undefined,
          videoElement: undefined,
          isPlaying: false,
        } as import('../types').MediaSource : null,
        position: layer.position || { x: 0.5, y: 0.5 },
        scale: layer.scale || { x: 1, y: 1 },
        rotation: layer.rotation || 0,
        flipH: layer.flipH || false,
        flipV: layer.flipV || false,
        corners: layer.corners || createDefaultCorners(),
        warpMode: layer.warpMode || 'corners',
        meshGrid: layer.meshGrid,
        effects: layer.effects || [],
        linesContent,
        svgContent: layer.svgContent,
        colorContent: layer.colorContent,
        lightPaintingContent: layer.lightPaintingContent || null,
        advLightPaintingContent: layer.advLightPaintingContent || null,
        textContent: layer.textContent || null,
        splatContent: layer.splatContent || null,
        model3dContent: layer.model3dContent || null,
        pixelFXContent: layer.pixelFXContent || null,
        gpuLayerContent: layer.gpuLayerContent || null,
        arcadeContent: layer.arcadeContent || null,
        mask: migratedMask,
        cropRegion: layer.cropRegion || null,
        layerShape: layer.layerShape || null,
        edgeEffects: layer.edgeEffects || null,
        vjLayerIndex: layer.vjLayerIndex,
        contentFit: layer.contentFit,
        renderQuality: layer.renderQuality,
        stageTextureFlipV: layer.stageTextureFlipV,
        parentGroupId: layer.parentGroupId ?? null,
        groupConfig: layer.groupConfig,
        groupCollapsed: layer.groupCollapsed,
      };
    },

    /**
     * Import a project from a saved JSON object.
     * Now supports vjMode (presets), media library, and VJ clip launcher.
     */
    importProject(data: unknown, projectDir?: string): boolean {
      try {
        const parsed = data as {
          version?: string;
          project?: {
            id?: string;
            name?: string;
            width?: number;
            height?: number;
            selectedLayerId?: string | null;
            layers?: Layer[];
            mappingComposition?: MappingCompositionState;
            vjMode?: any;
            mediaFolders?: MediaTrayFolder[];
            stage3d?: unknown;
            projectionSim?: unknown;
            showTimeline?: unknown;
          };
          mediaLibrary?: any[];
          vjClipLauncher?: any;
          modulation?: Array<{ key: string; mod: ParamModulation }>;
        };

        // Convert any local-filesystem path (Windows `C:\...` or Unix `/...`)
        // to a renderer-loadable URL.
        //
        // Inside Electron we cannot emit `file://` URLs to the renderer —
        // Chromium blocks them ("Not allowed to load local resource") even
        // for trusted local content. Using `file://` here was the actual
        // reason save→reload appeared to lose every video / image: the URL
        // resolved to a path the <video> tag was forbidden to open. We use
        // a custom `ghost-asset://` protocol registered in electron/main.js
        // that proxies to the disk file via main-process net.fetch.
        //
        // In the browser build (where __ELECTRON__ isn't set) the user-
        // picked File path doesn't survive anyway (the API doesn't expose
        // it), so the file:// branch here is cosmetic.
        const pathToFileUrl = (p: string): string => {
          let urlPath = p.replace(/\\/g, '/');
          if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
          const encoded = urlPath
            .replace(/%/g, '%25')
            .replace(/ /g, '%20')
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F');
          if (typeof window !== 'undefined' && (window as any).__ELECTRON__) {
            return 'ghost-asset://localhost' + encoded;
          }
          return 'file://' + encoded;
        };

        // Helper: resolve relative media paths against project directory.
        // Returns a renderer-loadable URL for any absolute filesystem path.
        //
        // Special case for `file://` URLs in Electron: these are the
        // residue of older builds that wrote `file://` paths into the
        // .gha (or that survive in autosave snapshots). Chromium refuses
        // to load them in <video>/<img>, so we transparently rewrite to
        // the ghost-asset:// custom protocol that DOES work. Without
        // this rewrite, opening any older project shows every media
        // layer as broken until the user re-imports each file by hand.
        const resolveSrc = (src: string): string => {
          if (!src) return src;
          /*
           * Pass through anything carrying a URI scheme, not just the four
           * that used to be listed. This is what stops an already-resolved
           * `ghost-asset://...` from being doubled when a project is opened,
           * re-saved and opened again. A Windows drive letter is checked first because
           * `C:\\clip.mp4` looks like a scheme; real schemes are two or more
           * characters, drives are exactly one.
           *
           * The old allowlist (https/blob/data/ghost-asset) silently mangled
           * every other scheme into a path: `builtin:grid` came back as
           * `<projectDir>/builtin:grid`, and `live://webcam/<id>` the same.
           * Opening any project saved with a built-in shader or a live source
           * rewrote its src to a file that does not exist, and re-saving
           * persisted the damage.
           */
          if (/^[A-Za-z]:[\\/]/.test(src)) return pathToFileUrl(src);
          if (/^file:/i.test(src)) {
            // Decode the file URL back to a path, then re-encode through
            // our pathToFileUrl which emits ghost-asset:// in Electron.
            const m = src.match(/^file:\/\/+(.*)$/i);
            if (!m) return src;
            try {
              return pathToFileUrl(decodeURIComponent(m[1]));
            } catch {
              return src;
            }
          }
          if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(src)) return src;
          let absPath: string | null = null;
          if (src.startsWith('/')) {
            absPath = src;
          } else if (projectDir) {
            const sep = projectDir.includes('\\') ? '\\' : '/';
            const base = projectDir.endsWith(sep) ? projectDir : projectDir + sep;
            absPath = base + src.replace(/^\.\//, '');
          }
          return absPath ? pathToFileUrl(absPath) : src;
        };

        // Resolve a media field by preferring an AssetRef, then falling back
        // to the legacy resolveSrc walk for projects from before AssetRef
        // shipped. The AssetRef path tries projectPath (sibling-copy beside
        // the .gha) first, then originalPath (machine-local disk path that
        // survives even without a Save As copy), then dataUrl, then url.
        // This is what makes save→close→reopen actually round-trip the
        // user's videos / 3D models / splats / images instead of coming
        // back with dead `./filename` references and an empty layer.
        const resolveWithRef = (ref: any, fallbackSrc: string): string => {
          if (ref && typeof ref === 'object') {
            if (ref.projectPath && projectDir) {
              const sep = projectDir.includes('\\') ? '\\' : '/';
              const base = projectDir.endsWith(sep) ? projectDir : projectDir + sep;
              return pathToFileUrl(base + String(ref.projectPath).replace(/^\.\//, ''));
            }
            if (ref.originalPath) return pathToFileUrl(String(ref.originalPath));
            if (ref.dataUrl) return String(ref.dataUrl);
            if (ref.url) return String(ref.url);
          }
          return resolveSrc(fallbackSrc);
        };

        const resolveGpuLayerAssetParams = (gpuLayerContent: any): void => {
          const seen = new WeakSet<object>();
          const walk = (node: any) => {
            if (!node || typeof node !== 'object') return;
            if (seen.has(node)) return;
            seen.add(node);

            if (node.type === 'file' && (node.url || node.assetRef || node._assetRef)) {
              node.url = resolveWithRef(node.assetRef || node._assetRef, node.url || '');
            }

            if (Array.isArray(node)) {
              for (const child of node) walk(child);
              return;
            }
            for (const value of Object.values(node)) walk(value);
          };
          walk(gpuLayerContent?.params);
        };

        if (!parsed.project) {
          console.error('Invalid project data: missing project object');
          return false;
        }

        const proj = parsed.project;
        try { vjClipLauncher.reset(); } catch { /* keep importing even if VJ runtime cleanup fails */ }

        // Import vjMode with compositions (presets)
        let importedVjMode: VJModeState | null = null;
        if (proj.vjMode) {
          const vjm = proj.vjMode;
          importedVjMode = {
            // Always land in mapping mode on import. If a project was saved
            // while VJ mode was active, restoring straight back into VJ left
            // the clip launcher in a half-initialized state — clicks did
            // nothing until the user exited and re-entered VJ. Forcing
            // mapping on open mirrors how every other VJ tool boots: design
            // view first, go-live by user action.
            enabled: false,
            activeCompositionId: vjm.activeCompositionId || null,
            masterOpacity: vjm.masterOpacity !== undefined ? vjm.masterOpacity : 1,
            compositions: (vjm.compositions || []).map((comp: any) => ({
              id: comp.id || generateUUID(),
              name: comp.name || 'Preset',
              thumbnail: comp.thumbnail,
              createdAt: comp.createdAt || Date.now(),
              layers: (comp.layers || []).map((layer: any) => {
                const imported = this._importLayer(layer);
                // Same multi-field resolve as the top-level project import below
                // — VJ compositions can carry splats / 3D models / splat
                // textures too, and they need the same `./filename` →
                // `file:///abs/path` rewriting so they don't open empty.
                // Prefer AssetRef when present so blob URLs that died at
                // session end still resolve to the original disk file.
                if (imported.source) {
                  imported.source.src = resolveWithRef(
                    (imported.source as any)._assetRef,
                    imported.source.src,
                  );
                }
                if (imported.splatContent) {
                  if (imported.splatContent.filePath || (imported.splatContent as any)._assetRef) {
                    imported.splatContent.filePath = resolveWithRef(
                      (imported.splatContent as any)._assetRef,
                      imported.splatContent.filePath,
                    );
                  }
                  if (imported.splatContent.texturePath || (imported.splatContent as any)._textureAssetRef) {
                    imported.splatContent.texturePath = resolveWithRef(
                      (imported.splatContent as any)._textureAssetRef,
                      imported.splatContent.texturePath,
                    );
                  }
                }
                if (imported.model3dContent) {
                  if (imported.model3dContent.modelData || (imported.model3dContent as any)._assetRef) {
                    imported.model3dContent.modelData = resolveWithRef(
                      (imported.model3dContent as any)._assetRef,
                      imported.model3dContent.modelData || '',
                    );
                  }
                }
                if ((imported as any).pixelFXContent) {
                  const px = (imported as any).pixelFXContent;
                  if (px.sourceUrl || px._sourceAssetRef) {
                    px.sourceUrl = resolveWithRef(px._sourceAssetRef, px.sourceUrl || '');
                  }
                }
                if ((imported as any).gpuLayerContent) {
                  resolveGpuLayerAssetParams((imported as any).gpuLayerContent);
                }
                return imported;
              }),
              synthVision: comp.synthVision,
            })),
            decks: (vjm.decks || []).map((deck: any) => ({
              id: deck.id || generateUUID(),
              name: deck.name || 'Deck',
              compositionId: deck.compositionId || null,
              opacity: deck.opacity !== undefined ? deck.opacity : 1,
              volume: deck.volume !== undefined ? deck.volume : 1,
              playbackSpeed: deck.playbackSpeed !== undefined ? deck.playbackSpeed : 1,
              isPlaying: false,
              transitionType: deck.transitionType || 'cut',
              transitionDuration: deck.transitionDuration || 0.5,
            })),
            timeline: vjm.timeline ? {
              clips: vjm.timeline.clips || [],
              loop: vjm.timeline.loop || false,
              totalDuration: vjm.timeline.totalDuration || 0,
              isPlaying: false,
              currentTime: 0,
            } : createDefaultTimeline(),
          };
        }

        // Import media library
        if (parsed.mediaLibrary && Array.isArray(parsed.mediaLibrary)) {
          // Clear existing media and add imported items
          mediaLibrary.reset();
          for (const item of parsed.mediaLibrary) {
            const ref = (item as any)._assetRef;
            const resolvedSrc = resolveWithRef(ref, item.src || '');
            const mediaType = item.type || 'image';
            const savedThumbnail = typeof item.thumbnail === 'string' && !item.thumbnail.startsWith('blob:')
              ? item.thumbnail
              : undefined;
            mediaLibrary.addItem({
              id: item.id || generateUUID(),
              name: item.name || 'Media',
              src: resolvedSrc,
              type: mediaType,
              thumbnail: savedThumbnail || (mediaType === 'image' ? resolvedSrc : item.thumbnail),
              // Carry the assetRef forward so future re-saves don't lose
              // the original disk path. Without this, every save→reload
              // cycle would erase the durable identity for library entries.
              _assetRef: ref,
              // Runtime properties will be recreated when media is loaded
              videoElement: undefined,
              texture: undefined,
            });
          }
        }

        // Import VJ Clip Launcher state
        if (parsed.vjClipLauncher) {
          const vjcl = parsed.vjClipLauncher;

          // Recover dynamic dimensions (fallback to defaults for older project files)
          const importNumLayers = vjcl.numLayers || DEFAULT_VJ_LAYERS;
          const importNumColumns = vjcl.numColumns || DEFAULT_VJ_COLUMNS;

          // Helper to import a clip (strips runtime objects)
          const importClip = (clip: any): VJClip | null => {
            if (!clip) return null;
            // Resolve the runtime URL via assetRef when available — without
            // this, VJ clips that were created via drag-drop come back with
            // dead blob: URLs after reload.
            const clipType = clip.type || 'image';
            const baseSrc = resolveWithRef(clip._assetRef, clip.src || '');
            const savedThumbnail = typeof clip.thumbnail === 'string' && !clip.thumbnail.startsWith('blob:')
              ? clip.thumbnail
              : undefined;
            // Splat/Model3D clip-shaped content lives on splatContent /
            // model3DContent off the clip (added by VJModePanel). Resolve
            // those too so clip-launcher cells with .ply / .glb survive.
            if (clip.splatContent) {
              if (clip.splatContent.filePath || clip.splatContent._assetRef) {
                clip.splatContent.filePath = resolveWithRef(
                  clip.splatContent._assetRef,
                  clip.splatContent.filePath || '',
                );
              }
              if (clip.splatContent.texturePath || clip.splatContent._textureAssetRef) {
                clip.splatContent.texturePath = resolveWithRef(
                  clip.splatContent._textureAssetRef,
                  clip.splatContent.texturePath || '',
                );
              }
            }
            const clipModel3dContent = clip.model3dContent || clip.model3DContent;
            if (clipModel3dContent) {
              if (clipModel3dContent.modelData || clipModel3dContent._assetRef) {
                clipModel3dContent.modelData = resolveWithRef(
                  clipModel3dContent._assetRef,
                  clipModel3dContent.modelData || '',
                );
              }
            }
            if (clip.gpuLayerContent) {
              resolveGpuLayerAssetParams(clip.gpuLayerContent);
            }
            return {
              id: clip.id || generateUUID(),
              type: clipType,
              name: clip.name || 'Clip',
              src: baseSrc,
              thumbnail: savedThumbnail || (clipType === 'image' ? baseSrc : clip.thumbnail),
              shaderCode: clip.shaderCode,
              shaderValues: clip.shaderValues || {},
              playbackMode: clip.playbackMode || 'loop',
              playbackRate: clip.playbackRate ?? 1,
              trimStart: clip.trimStart ?? 0,
              trimEnd: clip.trimEnd ?? 1,
              isPlaying: clip.isPlaying ?? true,
              // Audio stays OFF unless the saved project explicitly says
              // otherwise — `=== true` so a stray truthy value from a
              // hand-edited file can't silently un-mute a show.
              audioPlayback: clip.audioPlayback === true,
              audioVolume: clip.audioVolume ?? 1,
              audioMuted: clip.audioMuted === true,
              zoom: clip.zoom ?? 1,
              fit: clip.fit || 'cover',
              anchorX: clip.anchorX ?? 0.5,
              anchorY: clip.anchorY ?? 0.5,
              rotation: clip.rotation ?? 0,
              opacity: clip.opacity ?? 1,
              spoutSource: clip.spoutSource,
              ndiSource: clip.ndiSource,
              effectSource: clip.effectSource,
              jsAnimation: clip.jsAnimation,
              effects: clip.effects || [],
              splatContent: clip.splatContent,
              model3dContent: clipModel3dContent,
              gpuLayerContent: clip.gpuLayerContent,
              textContent: clip.textContent,
              presetId: clip.presetId,
              shaderValueAuto: clip.shaderValueAuto,
              mirrorX: clip.mirrorX,
              playbackSyncBeats: clip.playbackSyncBeats ?? null,
              durationSeconds: clip.durationSeconds,
              _assetRef: clip._assetRef,
              // videoElement will be recreated at runtime
            } as any;
          };

          // Helper: hydrate a saved 2D grid into a properly-shaped grid that
          // matches the project's current dimensions. Pads/truncates as
          // needed so hand-edited or partially-loaded files don't crash.
          const hydrateGrid = (saved: any): (VJClip | null)[][] => {
            const arr = Array.isArray(saved) ? saved : [];
            return Array.from({ length: importNumLayers }, (_, layerIdx) => {
              const row = (arr[layerIdx] || []) as any[];
              return Array.from({ length: importNumColumns }, (_, colIdx) =>
                importClip(row[colIdx] ?? null)
              );
            });
          };

          // Import blocks with BOTH bank grids (v1.7.0+ format). Blocks from
          // older saves only have clipGrid → bankBClipGrid lazy-inits empty.
          const importedBlocks: VJBlock[] = (vjcl.blocks || []).map((block: any) => ({
            id: block.id || generateUUID(),
            name: block.name || 'Block',
            clipGrid: hydrateGrid(block.clipGrid),
            bankBClipGrid: hydrateGrid(block.bankBClipGrid),
          }));

          // Ensure we have at least one block
          if (importedBlocks.length === 0) {
            importedBlocks.push({
              id: generateUUID(),
              name: 'Block 1',
              clipGrid: Array(importNumLayers).fill(null).map(() => Array(importNumColumns).fill(null)),
              bankBClipGrid: Array(importNumLayers).fill(null).map(() => Array(importNumColumns).fill(null)),
            });
          }

          // Import layer states
          const importedLayerStates: VJLayerState[] = (vjcl.layerStates || []).map((ls: any) => ({
            opacity: ls.opacity !== undefined ? ls.opacity : 1,
            blendMode: ls.blendMode || 'normal',
            solo: ls.solo || false,
            mute: ls.mute || false,
            activeColumn: ls.activeColumn ?? null,
            activeClip: importClip(ls.activeClip),
            effects: ls.effects || [],
          }));

          // Ensure we have the right number of layer states
          while (importedLayerStates.length < importNumLayers) {
            importedLayerStates.push({
              opacity: 1,
              blendMode: 'normal' as BlendMode,
              solo: false,
              mute: false,
              activeColumn: null,
              activeClip: null,
              effects: [],
            });
          }

          // Find active block or use first one
          const activeBlockId = vjcl.activeBlockId && importedBlocks.some((b: VJBlock) => b.id === vjcl.activeBlockId)
            ? vjcl.activeBlockId
            : importedBlocks[0].id;
          const activeBlock = importedBlocks.find((b: VJBlock) => b.id === activeBlockId)!;

          // ===== Bank B import (v1.7.0+) =====
          // Saved Bank B grid + layer states if present; otherwise build
          // empty defaults so the dual-deck UI has something to render to.
          // Pre-1.7 saves won't have these fields → empty defaults preserve
          // the legacy single-deck experience.
          const defaultBankBState = (): VJLayerState => ({
            opacity: 1,
            blendMode: 'normal' as BlendMode,
            solo: false,
            mute: false,
            activeColumn: null,
            activeClip: null,
            effects: [],
          });

          // Live Bank B grid is the active block's bankBClipGrid (v1.8 model).
          // Fall back to the v1.7 launcher-root field for transitional saves
          // that wrote bankBClipGrid at the launcher level instead of inside
          // each block.
          let bankBClipGrid: (VJClip | null)[][];
          if (activeBlock.bankBClipGrid && activeBlock.bankBClipGrid.length > 0) {
            bankBClipGrid = activeBlock.bankBClipGrid.map(row => [...row]);
          } else if (Array.isArray((vjcl as any).bankBClipGrid) && (vjcl as any).bankBClipGrid.length > 0) {
            bankBClipGrid = hydrateGrid((vjcl as any).bankBClipGrid);
            // Backfill the active block so subsequent block-switches use the
            // imported v1.7 root grid as Bank B for this block.
            const ab = importedBlocks.find(b => b.id === activeBlockId);
            if (ab) ab.bankBClipGrid = bankBClipGrid.map(row => [...row]);
          } else {
            bankBClipGrid = Array.from({ length: importNumLayers }, () =>
              Array(importNumColumns).fill(null)
            );
          }

          let bankBLayerStates: VJLayerState[];
          if (Array.isArray(vjcl.bankBLayerStates) && vjcl.bankBLayerStates.length > 0) {
            bankBLayerStates = (vjcl.bankBLayerStates as any[]).slice(0, importNumLayers).map((ls: any) => ({
              opacity: ls.opacity !== undefined ? ls.opacity : 1,
              blendMode: ls.blendMode || 'normal',
              solo: ls.solo || false,
              mute: ls.mute || false,
              activeColumn: ls.activeColumn ?? null,
              activeClip: importClip(ls.activeClip),
              effects: ls.effects || [],
            }));
            // Pad with defaults if the saved array is shorter than current dims
            while (bankBLayerStates.length < importNumLayers) {
              bankBLayerStates.push(defaultBankBState());
            }
          } else {
            bankBLayerStates = Array.from({ length: importNumLayers }, defaultBankBState);
          }

          // ===== Crossfader settings (v1.7.0+) =====
          // Restore the user's last A/B mix and transition choice. Pre-1.7
          // saves get safe defaults (crossfader off, dissolve, constant-power).
          const importedXfadeEnabled = !!vjcl.crossfaderEnabled;
          const importedXfadeValue = typeof vjcl.crossfaderValue === 'number'
            ? Math.max(0, Math.min(1, vjcl.crossfaderValue))
            : 0;
          const validTransitions = ['dissolve','wipe','rgb-split','cube','shatter','halftone','glitch','liquid','strobe','slide'];
          const importedXfadeTransition = validTransitions.includes(vjcl.crossfaderTransition)
            ? vjcl.crossfaderTransition
            : 'dissolve';
          const validCurves = ['linear','constant-power','sharp-cut'];
          const importedXfadeCurve = validCurves.includes(vjcl.crossfaderCurve)
            ? vjcl.crossfaderCurve
            : 'constant-power';
          const validBlendModes = ['normal','multiply','screen','add','difference','darken','lighten','overlay','exclusion'];
          const importedXfadeBlendMode = validBlendModes.includes(vjcl.crossfaderBlendMode)
            ? vjcl.crossfaderBlendMode
            : 'normal';
          const importedXfadeFadeDuration = typeof vjcl.crossfaderFadeDuration === 'number'
            ? Math.max(0, Math.min(8, vjcl.crossfaderFadeDuration))
            : 0;
          const importedSelectedDeck: 'A' | 'B' = vjcl.selectedDeck === 'B' ? 'B' : 'A';
          const validQuant = ['off', '1/4', '1/2', '1bar', '2bar', '4bar'];
          const importedQuant = validQuant.includes(vjcl.quantization)
            ? vjcl.quantization
            : 'off';

          // Set the VJ clip launcher state
          vjClipLauncher.set({
            numLayers: importNumLayers,
            numColumns: importNumColumns,
            blocks: importedBlocks,
            activeBlockId,
            clipGrid: activeBlock.clipGrid.map(row => [...row]),
            layerStates: importedLayerStates,
            bankBClipGrid,
            bankBLayerStates,
            selectedDeck: importedSelectedDeck,
            selectedLayerIndex: null,
            masterOpacity: vjcl.masterOpacity !== undefined ? vjcl.masterOpacity : 1,
            // Always land in mapping mode on import. Restoring the launcher
            // panel as `isOpen: true` left the VJ clip rehydration in a
            // half-initialized state — clicking clips did nothing until the
            // user exited and re-entered VJ. Forcing closed mirrors how
            // every other VJ tool boots: design view first, go-live by
            // explicit user action.
            isOpen: false,
            isLive: false, // Never import as live
            compositionEffects: vjcl.compositionEffects || [],
            stageMode: false, // Never import as stage mode active
            stagePresetId: vjcl.stagePresetId || null,
            mapMode: false, // Never import as map mode active
            stoppedAll: false,
            crossfaderEnabled: importedXfadeEnabled,
            crossfaderValue: importedXfadeValue,
            crossfaderTransition: importedXfadeTransition as any,
            crossfaderCurve: importedXfadeCurve as any,
            crossfaderBlendMode: importedXfadeBlendMode as any,
            crossfaderFadeDuration: importedXfadeFadeDuration,
            quantization: importedQuant as any,
            // pendingTriggers are session-only — never persisted
            pendingTriggers: [],
          });

          console.log('Imported VJ Clip Launcher with', importedBlocks.length, 'blocks,', importNumLayers, 'layers,', importNumColumns, 'columns');
        }

        // Import modulation assignments. Pass the raw `{key, mod}` entries
        // straight to bulkLoad — must NOT route through setModulation,
        // which would split the legacy `layerIndex:paramName` shape and
        // mangle the new key formats:
        //   "B:N:paramName"           → Bank B shader
        //   "N:fx:effectId:paramName" → effect (either bank)
        //   "B:N:fx:effectId:paramName" → Bank B effect
        //   "xfade:value"             → crossfader value
        if (Array.isArray(parsed.modulation)) {
          modulationStore.bulkLoad(parsed.modulation);
        } else {
          modulationStore.clearAll();
        }

        // Import keyframe timelines
        if (Array.isArray((parsed as any).keyframeTimelines)) {
          keyframeTimeline.importAll((parsed as any).keyframeTimelines);
        } else {
          keyframeTimeline.reset();
        }

        // Import macros (8 knobs + destinations). Backward-compat tolerant:
        // older saves without `macros` get fresh defaults via reset().
        if ((parsed as any).macros) {
          macros.hydrate((parsed as any).macros);
        } else {
          macros.reset();
        }

        // Import snapshot bank (16 capture slots). Older saves don't have
        // them — reset() pre-populates 16 empty slots.
        if ((parsed as any).snapshots) {
          snapshots.hydrate((parsed as any).snapshots);
        } else {
          snapshots.reset();
        }

        // Import OSC config (port + bindings + enabled flag). Older
        // saves don't carry it — reset to defaults so the listener
        // isn't accidentally auto-started.
        if ((parsed as any).osc) {
          oscStore.hydrate((parsed as any).osc);
        } else {
          oscStore.reset();
        }

        // Import keyboard control bindings. Older saves don't carry them
        // — reset to empty/disabled so the surface isn't auto-armed.
        if ((parsed as any).keyboard) {
          keyboardStore.hydrate((parsed as any).keyboard);
        } else {
          keyboardStore.reset();
        }

        // Import MediaPipe bindings. Older saves don't carry them —
        // reset to empty so a project that wasn't built around gestures
        // doesn't inherit them from whatever was loaded before.
        if ((parsed as any).mediaPipe) {
          mediaPipeBus.hydrate((parsed as any).mediaPipe);
        } else {
          mediaPipeBus.reset();
        }

        // Import SynthVision PROJECT-ROOT state (added 1.9.1). Saves
        // before that only carry SynthVision inside compositions, so
        // this no-ops on legacy projects — the per-composition load
        // path further down still restores composition-scoped state.
        if ((parsed as any).synthVision) {
          try { synthVisionStore.loadSerializable((parsed as any).synthVision); }
          catch (e) { console.warn('[Import] synthVision restore failed:', e); }
        }

        // Import user audio settings (added 1.9.1). Sensitivity /
        // smoothing / manual BPM / per-band gains. Older saves silently
        // skip — defaults already in the store from createDefaultState().
        const audioPayload = (parsed as any).audio;
        if (audioPayload && typeof audioPayload === 'object') {
          if (typeof audioPayload.sensitivity === 'number') audioStore.setSensitivity(audioPayload.sensitivity);
          if (typeof audioPayload.smoothing === 'number') audioStore.setSmoothing(audioPayload.smoothing);
          if (typeof audioPayload.manualBPM === 'number') audioStore.setManualBPM(audioPayload.manualBPM);
          if (audioPayload.bandGain && typeof audioPayload.bandGain === 'object') {
            for (const [band, val] of Object.entries(audioPayload.bandGain)) {
              if (typeof val === 'number') {
                audioStore.setBandGain(band as any, val);
              }
            }
          }
        }

        // Import layer step sequencer (added 1.9.3). Older saves don't
        // have the field — hydrate() resets to a clean empty pattern in
        // that case so the user gets a predictable starting state.
        if ((parsed as any).layerSequencer) {
          try { layerSequencer.hydrate((parsed as any).layerSequencer); }
          catch (e) { console.warn('[Import] layerSequencer restore failed:', e); }
        }

        // Import GeoDeck (added 1.9.3). Older saves keep current store
        // defaults.
        if ((parsed as any).geoDeck) {
          try { geoDeckStore.hydrate((parsed as any).geoDeck); }
          catch (e) { console.warn('[Import] geoDeck restore failed:', e); }
        }

        // Reconstruct the project with proper defaults
        const importedProject: Project = {
          id: proj.id || generateUUID(),
          name: proj.name || 'Imported Project',
          width: proj.width || 1920,
          height: proj.height || 1080,
          selectedLayerId: proj.selectedLayerId || null,
          layers: (proj.layers || []).map(layer => {
            const imported = this._importLayer(layer);
            // Resolve every media-path field. Prefer AssetRef so blob URLs
            // that died at session end still resolve to the originating
            // disk file (or the sibling-copy beside the .gha). Falls back
            // to the legacy resolveSrc when no assetRef is present (older
            // projects from before assetRef shipped).
            if (imported.source) {
              imported.source.src = resolveWithRef(
                (imported.source as any)._assetRef,
                imported.source.src,
              );
              if (isVideoSource(imported.source)) {
                rehydrateVideoSource(imported.source);
              }
            }
            if (imported.splatContent) {
              if (imported.splatContent.filePath || (imported.splatContent as any)._assetRef) {
                imported.splatContent.filePath = resolveWithRef(
                  (imported.splatContent as any)._assetRef,
                  imported.splatContent.filePath,
                );
              }
              if (imported.splatContent.texturePath || (imported.splatContent as any)._textureAssetRef) {
                imported.splatContent.texturePath = resolveWithRef(
                  (imported.splatContent as any)._textureAssetRef,
                  imported.splatContent.texturePath,
                );
              }
            }
            if (imported.model3dContent) {
              if (imported.model3dContent.modelData || (imported.model3dContent as any)._assetRef) {
                imported.model3dContent.modelData = resolveWithRef(
                  (imported.model3dContent as any)._assetRef,
                  imported.model3dContent.modelData || '',
                );
              }
            }
            if ((imported as any).pixelFXContent) {
              const px = (imported as any).pixelFXContent;
              if (px.sourceUrl || px._sourceAssetRef) {
                px.sourceUrl = resolveWithRef(px._sourceAssetRef, px.sourceUrl || '');
              }
            }
            if ((imported as any).gpuLayerContent) {
              resolveGpuLayerAssetParams((imported as any).gpuLayerContent);
            }
            return imported;
          }),
          mappingComposition: normalizeMappingCompositionState(proj.mappingComposition),
          vjMode: importedVjMode,
          mediaFolders: normalizeMediaTrayFolders(proj.mediaFolders),
          stagePresets: (proj as any).stagePresets || [],
          svKeyboardPresets: (proj as any).svKeyboardPresets || [],
          surfaces: (proj as any).surfaces || [],
          activeSurfaceId: (proj as any).activeSurfaceId ?? null,
        };

        set(importedProject);
        selectedLayerIdsState.set(importedProject.selectedLayerId ? [importedProject.selectedLayerId] : []);
        const importedStage3d = (proj as any).stage3d;
        const incomingSyncedStage3d = (parsed as any).stage3dScene;
        queueMicrotask(() => {
          try {
            if (importedStage3d?.schemaVersion === 1 && Array.isArray(importedStage3d.nodes)) {
              stage3dScene.loadScene(importedStage3d);
            } else if (incomingSyncedStage3d?.schemaVersion === 1 && Array.isArray(incomingSyncedStage3d.nodes)) {
              // State-sync payloads apply Stage 3D separately after
              // project import. Do not clear the scene in between.
            } else {
              stage3dScene.newScene();
            }
          } catch (err) {
            console.warn('[Store] importProject: 3D scene restore failed', err);
          }
          try {
            const importedSim = (proj as any).projectionSim;
            if (importedSim?.schemaVersion === 1
              && Array.isArray(importedSim.objects)
              && Array.isArray(importedSim.projectors)) {
              projectionSimScene.loadSceneFromProject(importedSim, projectDir);
            }
            // No else: a project without the section keeps the store's
            // session scene (fresh launches land on the cube-pyramid preset).
          } catch (err) {
            console.warn('[Store] importProject: projection sim restore failed', err);
          }
          try {
            const importedShow = (proj as any).showTimeline;
            if (importedShow && typeof importedShow === 'object') {
              // projectDir-aware so audio AssetRefs saved as siblings of the
              // .gha resolve on another machine. Never auto-plays.
              showTimeline.hydrate(importedShow, projectDir);
            } else if ('stage3d' in (proj as any) || 'projectionSim' in (proj as any)) {
              // Save-shaped payload (only the save/autosave exports carry the
              // save-only sections) that has no show of its own — a
              // pre-1.9.5 file, or a project the user never programmed.
              // Clear, so the previous project's arrangement cannot bleed
              // through and start firing presets over the new one.
              showTimeline.hydrate(null);
            }
            // No else: this is a LIVE STATE-SYNC payload. exportProject()
            // deliberately omits every save-only section, so "absent" here
            // means "not transmitted", not "empty". Clearing on it would
            // wipe the receiver's timeline on every relay tick — the exact
            // failure mode the stage3d note above documents.
          } catch (err) {
            console.warn('[Store] importProject: show timeline restore failed', err);
          }
        });
        // Hydrate $settings.output from the project's multi-output
        // snapshot, if one was saved. Slices run through the migration
        // shim so older .gha files without per-edge-gamma / black-level
        // fields pick up sane defaults. We update settings (not project)
        // because the per-frame slice extractor in Canvas.svelte reads
        // from $settings.output; the project copy is just persistence.
        const incomingSlices = (proj as any).outputSlices;
        const incomingMW = (proj as any).outputMasterCanvasWidth;
        const incomingMH = (proj as any).outputMasterCanvasHeight;
        const incomingMasterWarp = (proj as any).outputMasterWarp;
        if (Array.isArray(incomingSlices) || typeof incomingMW === 'number' || typeof incomingMH === 'number'
            || (incomingMasterWarp && typeof incomingMasterWarp === 'object')) {
          settings.update(s => ({
            ...s,
            output: {
              ...s.output,
              ...(Array.isArray(incomingSlices) ? {
                slices: incomingSlices.map((sl: any) =>
                  migrateOutputSlice({ ...sl, id: sl?.id ?? `slice-${Math.random().toString(36).slice(2)}` })
                ),
              } : {}),
              ...(typeof incomingMW === 'number' ? { masterCanvasWidth: incomingMW } : {}),
              ...(typeof incomingMH === 'number' ? { masterCanvasHeight: incomingMH } : {}),
              ...(incomingMasterWarp && typeof incomingMasterWarp === 'object'
                ? { masterWarp: { enabled: false, mode: 'corners', ...incomingMasterWarp } }
                : {}),
            },
          }));
        }
        // Hydrate the Stage Designer surface store from the imported
        // project. Deferred via dynamic import + microtask so the
        // surface module — which lazily loads here — doesn't introduce
        // a circular dep at module-evaluation time.
        if (importedProject.surfaces?.length) {
          void import('./surface').then(({ surfaceStore }) => {
            queueMicrotask(() => surfaceStore.hydrateFromProject(
              importedProject.surfaces!,
              importedProject.activeSurfaceId ?? null,
            ));
          });
        }
        console.log('Project imported successfully with', importedProject.layers.length, 'layers');
        if (importedVjMode) {
          console.log('Imported', importedVjMode.compositions.length, 'presets');
        }
        return true;
      } catch (err) {
        console.error('Failed to import project:', err);
        return false;
      }
    },

    /**
     * Import project from a JSON string.
     */
    importProjectJSON(jsonString: string, projectDir?: string): boolean {
      try {
        const data = JSON.parse(jsonString);
        return this.importProject(data, projectDir);
      } catch (err) {
        console.error('Failed to parse project JSON:', err);
        return false;
      }
    },
  };

  return store;
}

export const project = createProjectStore();

// ─── Show timeline → composition loader ──────────────────────────────────
// The show timeline must be able to fire a preset without importing this
// module (that would be a cycle, and it would drag the whole project store
// into every unit test of the arrangement maths). Register the real loader
// here — layers.ts is loaded by everything, so this always lands before any
// timeline can run.
setShowCompositionLoader((compositionId, options) => {
  project.loadComposition(compositionId, { restoreTransports: options.restoreTransports });
});

// ─── Mapping-mode clip audio reconciliation ──────────────────────────────
// One central place decides which mapping-mode media layers are audible,
// instead of scattering attach/detach through every edit path (create,
// import, rehydrate, toggle, delete). Runs on every project change, but
// short-circuits to a single `Set.size === 0` check when nothing has opted
// in — which is every project that never touches the feature.
//
// Layer media video elements are safe to wire directly: unlike the VJ clip
// pool they are created once per MediaSource object and never re-`src`ed
// (see media/videoSourceRestore.ts and LayerPanel.createMediaSource), so
// each element gets exactly one createMediaElementSource() for its lifetime.
const audibleLayerSourceIds = new Set<string>();

function reconcileLayerMediaAudio($project: Project): void {
  const seen = new Set<string>();
  for (const layer of $project.layers) {
    const source = layer.source;
    if (!source || source.type !== 'video' || source.audioPlayback !== true) continue;
    const element = source.videoElement;
    if (!element) continue;
    seen.add(source.id);
    const layerId = layer.id;
    const sourceId = source.id;
    if (!audibleLayerSourceIds.has(sourceId)) {
      const ok = clipAudioBus.attachClip(sourceId, element, {
        volume: source.audioVolume ?? 1,
        muted: source.audioMuted === true,
        provider: () => {
          const current = get(project).layers.find((l) => l.id === layerId)?.source;
          if (!current || current.id !== sourceId || current.audioPlayback !== true) return null;
          return mediaSourceAudioTransport(current);
        },
      });
      if (ok) audibleLayerSourceIds.add(sourceId);
    } else {
      clipAudioBus.setClipVolume(sourceId, source.audioVolume ?? 1);
      clipAudioBus.setClipMuted(sourceId, source.audioMuted === true);
    }
  }
  if (audibleLayerSourceIds.size === 0) return;
  for (const id of Array.from(audibleLayerSourceIds)) {
    if (seen.has(id)) continue;
    clipAudioBus.detachClip(id);
    audibleLayerSourceIds.delete(id);
  }
}

/** Wrapped playhead time + transport for a mapping-mode media source.
 *  Mirrors LayerPanel's `sourcePlaybackTime` so the audio element chases
 *  exactly the value the render authority is presenting. */
function mediaSourceAudioTransport(source: MediaSource): ClipAudioTransport {
  const duration = Number(source.durationSeconds ?? source.videoElement?.duration);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const nativeTime = Number(source._nativePlaybackTimeSeconds);
  const elementTime = Number(source.videoElement?.currentTime);
  let time = Number.isFinite(nativeTime) && nativeTime >= 0
    ? nativeTime
    : Number.isFinite(elementTime) && elementTime >= 0
      ? elementTime
      : 0;
  const anchorMs = Number(source._nativePlaybackUpdatedAtMs);
  const rate = Number(source.playbackRate) || 1;
  const paused = source.isPlaying === false;
  if (!paused && Number.isFinite(anchorMs)) {
    time += Math.max(0, performance.now() - anchorMs) / 1000 * rate;
  }
  const trimStart = hasDuration ? duration * Math.max(0, Math.min(1, source.trimStart ?? 0)) : 0;
  const trimEnd = hasDuration ? duration * Math.max(0, Math.min(1, source.trimEnd ?? 1)) : 0;
  const loop = (source.playbackMode ?? 'loop') !== 'once';
  if (hasDuration) {
    const range = Math.max(0.001, trimEnd - trimStart);
    time = loop
      ? trimStart + (((time - trimStart) % range) + range) % range
      : Math.max(trimStart, Math.min(trimEnd, time));
  }
  return {
    timeSeconds: Math.max(0, time),
    playbackRate: rate,
    paused,
    loop,
    trimStartSeconds: trimStart,
    trimEndSeconds: trimEnd,
    seekGeneration: Math.max(0, Math.round(Number(source._nativePlaybackSeekSeq ?? 0))),
    durationSeconds: hasDuration ? duration : undefined,
  };
}

project.subscribe(($project) => {
  try {
    reconcileLayerMediaAudio($project);
  } catch (err) {
    console.warn('[layers] Clip audio reconcile failed:', err);
  }
});

// Derived stores for convenience
export const layers = derived(project, ($project) => $project.layers);

export const selectedLayerId = derived(project, ($project) => $project.selectedLayerId);
export const selectedLayerIds = derived(selectedLayerIdsState, ($ids) => $ids);

export const selectedLayer = derived(project, ($project) =>
  $project.layers.find((l) => l.id === $project.selectedLayerId) || null
);

export const visibleLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.visible)
);

// Lines layer helpers
export const linesLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'lines')
);

export const selectedLinesLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'lines' ? layer : null;
});

export const selectedLineElement = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'lines' || !layer.linesContent) return null;
  return layer.linesContent.elements.find(
    (e) => e.id === layer.linesContent!.selectedElementId
  ) || null;
});

// Compatibility aliases for DrawingPanel (old names → new names)
export const selectedGenerativeLayer = selectedLinesLayer;
// DrawingPanel accesses .fill, .animation, .shape.position etc. which don't exist on LineElement
// Cast to any for backwards compatibility until DrawingPanel is fully migrated to lines API
export const selectedElement = derived(selectedLineElement, (el) => el as any);

// SVG layer helpers
export const svgLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'svg')
);

export const selectedSVGLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'svg' ? layer : null;
});

export const selectedSVGContent = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'svg' || !layer.svgContent) return null;
  return layer.svgContent;
});

// Media layer derived stores
export const selectedMediaLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'media' ? layer : null;
});

export const selectedGroupLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'group' ? layer : null;
});

// Light painting derived stores
export const lightPaintingLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'lightpainting')
);

export const selectedLightPaintingLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'lightpainting' ? layer : null;
});

export const selectedLightPaintingContent = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'lightpainting' || !layer.lightPaintingContent) return null;
  return layer.lightPaintingContent;
});

// Adv Light Painting (WebGPU) derived stores
export const advLightPaintingLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'adv-lightpaint')
);

export const selectedAdvLightPaintingLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'adv-lightpaint' ? layer : null;
});

// Text layer derived stores
export const textLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'text')
);

export const selectedTextLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'text' ? layer : null;
});

// Splat layer derived stores (Point Cloud / Gaussian Splat)
export const splatLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'splat')
);

export const selectedSplatLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'splat' ? layer : null;
});

export const selectedSplatContent = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'splat' || !layer.splatContent) return null;
  return layer.splatContent;
});

// Model3D derived stores
export const model3dLayers = derived(project, ($project) =>
  $project.layers.filter((l) => l.type === 'model3d')
);

export const selectedModel3DLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'model3d' ? layer : null;
});

export const selectedModel3DContent = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'model3d' || !layer.model3dContent) return null;
  return layer.model3dContent;
});

// Pixel FX layer helpers — selected layer + content. Used by the
// PixelFXPanel to read state and route updates back to the project
// store. Mirrors the pattern used by the other GPU layer types.
export const selectedPixelFXLayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'pixel-fx' ? layer : null;
});

// GPU layer helpers — selected layer + content for the GPULayerPanel.
export const selectedGPULayer = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  return layer?.type === 'gpu' ? layer : null;
});

export const selectedPixelFXContent = derived(project, ($project) => {
  const layer = $project.layers.find((l) => l.id === $project.selectedLayerId);
  if (!layer || layer.type !== 'pixel-fx' || !layer.pixelFXContent) return null;
  return layer.pixelFXContent;
});

// VJ Mode derived stores
export const vjMode = derived(project, ($project) => $project.vjMode);

export const vjModeEnabled = derived(project, ($project) =>
  $project.vjMode?.enabled ?? false
);

export const compositions = derived(project, ($project) =>
  $project.vjMode?.compositions ?? []
);

export const vjDecks = derived(project, ($project) =>
  $project.vjMode?.decks ?? []
);

export const timeline = derived(project, ($project) =>
  $project.vjMode?.timeline ?? createDefaultTimeline()
);

export const activeCompositionId = derived(project, ($project) =>
  $project.vjMode?.activeCompositionId ?? null
);

// Stage presets derived store
export const stagePresets = derived(project, ($project) =>
  $project.stagePresets ?? []
);

// SV keyboard presets derived store
export const svKeyboardPresets = derived(project, ($project) =>
  $project.svKeyboardPresets ?? []
);

// Helper to get current state synchronously
export function getProject(): Project {
  return get(project);
}

export function getSelectedLayer(): Layer | null {
  return get(selectedLayer);
}

export function getSelectedLineElement(): LineElement | null {
  return get(selectedLineElement);
}

export function getVJMode(): VJModeState | null {
  return get(vjMode);
}

export function getCompositions(): Composition[] {
  return get(compositions);
}

export function getVJDecks(): VJDeck[] {
  return get(vjDecks);
}

export function getTimeline(): Timeline {
  return get(timeline);
}

// ── Group layer helpers (pure functions) ──────────────────────────────────────

/** Get children of a group, ordered by position in the flat array */
export function getGroupChildren(layers: Layer[], groupId: string): Layer[] {
  return layers.filter(l => l.parentGroupId === groupId);
}

/** Get top-level layers (those not inside any group) */
export function getTopLevelLayers(layers: Layer[]): Layer[] {
  return layers.filter(l => !l.parentGroupId);
}

/** Get all group layers */
export function getGroupLayers(layers: Layer[]): Layer[] {
  return layers.filter(l => l.type === 'group');
}

// Register mapping mode callbacks for the modulation engine
// This lets audio modulation work on mapping mode layers (not just VJ clips)
import { registerMappingLayerCallbacks } from '../audio/modulation';

registerMappingLayerCallbacks(
  // updater: apply modulated values to a mapping layer's shader
  (layerIndex: number, values: Record<string, number>) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    if (layer?.source?.shaderValues) {
      project.batchUpdateLayerShaderValues(layer.id, values);
    }
  },
  // reader: get current shader value for initial base capture
  (layerIndex: number, paramName: string) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    const val = layer?.source?.shaderValues?.[paramName];
    return typeof val === 'number' ? val : undefined;
  },
  // isMapping: returns true when layer index refers to a mapping layer
  (layerIndex: number) => {
    const p = get(project);
    return !(p.vjMode?.enabled ?? false);
  },
  // effectUpdater: apply modulated effect-param values in mapping mode.
  // Goes through the project store's updateEffectParams so the change
  // also feeds the keyframe auto-record path. Without this, modulation
  // entries on effect params (set via the LayerPanel mod dropdowns)
  // would only fire in VJ mode and silently no-op in mapping.
  (layerIndex: number, effectId: string, values: Record<string, number>) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    if (!layer) return;
    project.updateEffectParams(layer.id, effectId, values);
  },
  // effectReader: capture current effect param as the modulation base
  (layerIndex: number, effectId: string, paramName: string) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    const eff = layer?.effects.find(e => e.id === effectId);
    const val = (eff?.params as Record<string, any> | undefined)?.[paramName];
    return typeof val === 'number' ? val : undefined;
  },
  // edgeEffectUpdater: write a modulated value into the nested edge-
  // effect structure. paramPath is `<topKey>.<nestedKey>` (e.g.
  // `stroke.width`); deep-merge so we don't clobber sibling keys on
  // the same subobject. Goes through project.updateEdgeEffect so the
  // change is part of the same undo/serialization path as user edits.
  (layerIndex: number, effectId: string, paramPath: string, value: number) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    if (!layer?.edgeEffects) return;
    const eff = layer.edgeEffects.effects.find(e => e.id === effectId);
    if (!eff) return;
    const dot = paramPath.indexOf('.');
    if (dot < 0) {
      // Top-level numeric (e.g. effect.opacity)
      project.updateEdgeEffect(layer.id, effectId, { [paramPath]: value } as any);
      return;
    }
    const topKey = paramPath.slice(0, dot);
    const nestedKey = paramPath.slice(dot + 1);
    const topObj = (eff as any)[topKey];
    if (!topObj || typeof topObj !== 'object') return;
    project.updateEdgeEffect(layer.id, effectId, {
      [topKey]: { ...topObj, [nestedKey]: value },
    } as any);
  },
  // edgeEffectReader: capture current nested value as the base.
  (layerIndex: number, effectId: string, paramPath: string) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    const eff = layer?.edgeEffects?.effects.find(e => e.id === effectId);
    if (!eff) return undefined;
    const dot = paramPath.indexOf('.');
    if (dot < 0) {
      const v = (eff as any)[paramPath];
      return typeof v === 'number' ? v : undefined;
    }
    const topKey = paramPath.slice(0, dot);
    const nestedKey = paramPath.slice(dot + 1);
    const topObj = (eff as any)[topKey];
    if (!topObj || typeof topObj !== 'object') return undefined;
    const v = topObj[nestedKey];
    return typeof v === 'number' ? v : undefined;
  },
  // gpuUpdater: batch-apply modulated GPU shader-layer param values.
  // Goes through project.updateGPULayerParams so keyframe auto-record
  // sees the change just like a manual drag would.
  (layerIndex: number, values: Record<string, number>) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    if (!layer?.gpuLayerContent) return;
    project.updateGPULayerParams(layer.id, values);
  },
  // gpuReader: capture current GPU param as the modulation base.
  (layerIndex: number, paramKey: string) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    const v = layer?.gpuLayerContent?.params?.[paramKey];
    return typeof v === 'number' ? v : undefined;
  },
  // splatUpdater: batch-apply audio / auto values to splat content.
  (layerIndex: number, values: Record<string, number>) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    if (!layer?.splatContent) return;
    project.updateSplatContent(layer.id, values as Partial<SplatContent>);
  },
  // splatReader: capture the current splat value as modulation base.
  (layerIndex: number, paramKey: string) => {
    const p = get(project);
    const layer = p.layers[layerIndex];
    const value = (layer?.splatContent as unknown as Record<string, unknown> | undefined)?.[paramKey];
    return typeof value === 'number' ? value : undefined;
  },
);
