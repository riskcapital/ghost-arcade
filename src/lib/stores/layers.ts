import { writable, derived, get } from 'svelte/store';
import type { Layer, Project, WarpCorners, Point2D, BezierPoint, MediaSource, BlendMode, WarpMode, Effect, EffectType, EffectParams, LayerType, SVGContent, SVGFillMode, SVGColorMode, ColorContent, LightPaintingContent, LightPaintingStroke, CropRegion, LayerShape, LayerShapeType, Composition, VJModeState, VJDeck, Timeline, TimelineClip, TextContent, TextAnimation, SplatContent, Model3DContent, MediaTrayFolder, StagePreset, SVKeyboardPreset, EdgeEffect, EdgeEffectsConfig } from '../types';
import { createLayer, createProject, createDefaultCorners, createMeshGrid, createLinesLayer, createSVGLayer, createColorLayer, createLightPaintingLayer, createTextLayer, createSplatLayer, createDefaultSVGContent, createDefaultCropRegion, createDefaultLayerShape, createDefaultVJModeState, createDefaultTimeline, generateUUID, createDefaultModel3DContent, createDefaultEdgeEffect, convertShapeToCustom, createGroupLayer } from '../types';
import type { GroupConfig } from '../types';
import { mediaLibrary } from './media';
import { vjClipLauncher, type VJClip, type VJBlock, type VJLayerState, DEFAULT_VJ_LAYERS, DEFAULT_VJ_COLUMNS } from './vjClipLauncher';
import { disposeJSAnimationContext } from '../renderer/js-animation';
import { synthVisionStore } from './synthVision';
import { modulationStore, type ParamModulation } from '../audio/modulation';
import { keyframeTimeline } from './keyframeTimeline';
import { macros } from './macros';
import { snapshots } from './snapshots';
import { createDefaultShapeMesh } from '../drawing/types';
import type { LineElement, LineShape, LinesContent, LineDrawAnimation, LineStroke } from '../lines/types';
import { maxLayers } from './license';
import { createLineElement, createDefaultLinesContent, createDefaultDrawAnimation } from '../lines/types';

// History recording callback — set from App.svelte to avoid circular imports
let _onDiscreteAction: (() => void) | null = null;
export function setHistoryCallback(fn: () => void) { _onDiscreteAction = fn; }
function recordDiscreteAction() { if (_onDiscreteAction) setTimeout(_onDiscreteAction, 0); }
const selectedLayerIdsState = writable<string[]>([]);

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

  const store = {
    subscribe,
    set,
    update,

    // Layer management
    addLayer(name?: string, type: LayerType = 'media', initialShapeType?: LayerShapeType) {
      const currentProject = get({ subscribe });
      const limit = get(maxLayers);
      if (currentProject.layers.length >= limit) {
        console.warn(`[License] Layer limit reached (${limit}). Upgrade to add more layers.`);
        // Dispatch a custom event so the UI can show an upgrade prompt
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('license-layer-limit', { detail: { limit } }));
        }
        return;
      }
      const id = generateUUID();
      update((project) => {
        const layerName = name || (type === 'lines'
          ? `Lines ${project.layers.filter(l => l.type === 'lines').length + 1}`
          : `Layer ${project.layers.filter(l => l.type === 'media').length + 1}`);
        const newLayer = createLayer(id, layerName, type);
        if (type === 'media' && initialShapeType) {
          newLayer.layerShape = createDefaultLayerShape(initialShapeType);
        }
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();

      // Auto-apply crosshair shader to media layers so the user can see placement
      if (type === 'media') {
        autoApplyDefaultShader(id);
      }
    },

    addLinesLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Lines ${project.layers.filter(l => l.type === 'lines').length + 1}`;
        const newLayer = createLinesLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addSVGLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `SVG ${project.layers.filter(l => l.type === 'svg').length + 1}`;
        const newLayer = createSVGLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addColorLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Color ${project.layers.filter(l => l.type === 'color').length + 1}`;
        const newLayer = createColorLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addLightPaintingLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Light Paint ${project.layers.filter(l => l.type === 'lightpainting').length + 1}`;
        const newLayer = createLightPaintingLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    // Text layer methods
    addTextLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Text ${project.layers.filter(l => l.type === 'text').length + 1}`;
        const newLayer = createTextLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    // Splat layer methods (Point Cloud / Gaussian Splat)
    addSplatLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Splat ${project.layers.filter(l => l.type === 'splat').length + 1}`;
        const newLayer = createSplatLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
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
      update((project) => {
        const id = generateUUID();
        const layerName = name || `3D Model ${project.layers.filter(l => l.type === 'model3d').length + 1}`;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'model3d'),
          model3dContent: createDefaultModel3DContent(),
        };
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();
    },

    addScreenLayer(name?: string) {
      const id = generateUUID();
      update((project) => {
        const layerName = name || `Screen ${project.layers.filter(l => l.type === 'screen').length + 1}`;
        const newLayer: Layer = {
          ...createLayer(id, layerName, 'screen'),
          vjLayerIndex: 0,
        };
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      recordDiscreteAction();

      // Auto-apply crosshair shader for alignment reference
      autoApplyDefaultShader(id);
    },

    // ── Group layer methods ────────────────────────────────────────────────

    addGroupLayer(name?: string) {
      update((project) => {
        const id = generateUUID();
        const layerName = name || `Group ${project.layers.filter(l => l.type === 'group').length + 1}`;
        const newLayer = createGroupLayer(id, layerName);
        return {
          ...project,
          layers: [newLayer, ...project.layers],
          selectedLayerId: id,
        };
      });
      selectedLayerIdsState.set([get({ subscribe }).selectedLayerId!]);
      recordDiscreteAction();
    },

    /** Create a group from currently selected layers */
    createGroupFromSelection() {
      const selectedIds = get(selectedLayerIdsState);
      if (selectedIds.length < 1) return;
      update((project) => {
        const groupId = generateUUID();
        const groupName = `Group ${project.layers.filter(l => l.type === 'group').length + 1}`;
        const groupLayer = createGroupLayer(groupId, groupName);

        // Find earliest selected layer position
        const indices = selectedIds.map(id => project.layers.findIndex(l => l.id === id)).filter(i => i >= 0);
        const insertAt = Math.min(...indices);

        // Remove selected from current positions, clear any existing parentGroupId
        const remaining = project.layers.filter(l => !selectedIds.includes(l.id));
        const children = project.layers
          .filter(l => selectedIds.includes(l.id) && l.type !== 'group') // no nested groups
          .map(l => ({ ...l, parentGroupId: groupId }));

        // Insert group + children at the position of the first selected
        const newLayers = [...remaining];
        newLayers.splice(insertAt, 0, groupLayer, ...children);

        return { ...project, layers: newLayers, selectedLayerId: groupId };
      });
      selectedLayerIdsState.set([get({ subscribe }).selectedLayerId!]);
      recordDiscreteAction();
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

    // Mask methods
    enableMask(layerId: string) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          // If a mask already exists (e.g. from a prior disable), force enabled=true
          // while preserving its points/feather/inverted. Without the explicit
          // override, `mask: layer.mask || {...}` short-circuits to the existing
          // (still disabled) object and the toggle never re-enables.
          return {
            ...layer,
            mask: layer.mask
              ? { ...layer.mask, enabled: true }
              : { enabled: true, points: [], inverted: false, feather: 0 },
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

    addMaskPoint(layerId: string, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? { ...layer, mask: { ...layer.mask, points: [...layer.mask.points, point] } }
            : layer
        ),
      }));
    },

    updateMaskPoint(layerId: string, pointIndex: number, point: Point2D) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? {
                ...layer,
                mask: {
                  ...layer.mask,
                  points: layer.mask.points.map((p, i) => (i === pointIndex ? point : p)),
                },
              }
            : layer
        ),
      }));
    },

    removeMaskPoint(layerId: string, pointIndex: number) {
      update((project) => ({
        ...project,
        layers: project.layers.map((layer) =>
          layer.id === layerId && layer.mask
            ? {
                ...layer,
                mask: {
                  ...layer.mask,
                  points: layer.mask.points.filter((_, i) => i !== pointIndex),
                },
              }
            : layer
        ),
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
              params: { ...layer.layerShape.params, customClosed: true },
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
      update((project) => {
        const layer = project.layers.find((l) => l.id === id);
        if (!layer) return project;

        const newId = generateUUID();
        const newLayer: Layer = {
          ...structuredClone(layer),
          id: newId,
          name: `${layer.name} Copy`,
        };

        const index = project.layers.findIndex((l) => l.id === id);
        const newLayers = [...project.layers];

        if (layer.type === 'group') {
          // Deep-clone: duplicate all children with new IDs
          const children = project.layers.filter(l => l.parentGroupId === id);
          const clonedChildren = children.map(child => ({
            ...structuredClone(child),
            id: generateUUID(),
            parentGroupId: newId,
          }));
          // Find the end of this group's block
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
      update((project) => {
        // Find the old layer source to clean up
        const oldLayer = project.layers.find(l => l.id === id);
        const oldSource = oldLayer?.source;

        // Dispose old JS animation context if it exists and is different from the new one
        if (oldSource && oldSource.jsAnimation && oldSource.id !== source?.id) {
          console.log('Disposing old JS animation context:', oldSource.id, oldSource.name);
          disposeJSAnimationContext(oldSource.id);
        }

        // Dispose old texture if it exists
        if (oldSource?.texture && oldSource.id !== source?.id) {
          console.log('Disposing old texture for:', oldSource.name);
          oldSource.texture.dispose();
        }

        return {
          ...project,
          layers: project.layers.map((l) => (l.id === id ? { ...l, source } : l)),
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

    setRenderQuality(id: string, renderQuality: number) {
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
      const presetId = generateUUID();

      // Deep clone layers, strip runtime objects
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
          console.warn('[Store] Failed to clone layer for stage preset:', layer.id, e);
        }
      }

      const preset: StagePreset = {
        id: presetId,
        name,
        thumbnail,
        createdAt: Date.now(),
        layers: layersSnapshot,
      };

      update((project) => ({
        ...project,
        stagePresets: [...(project.stagePresets || []), preset],
      }));

      return presetId;
    },

    /** Load a stage preset — replaces project.layers with the preset's saved layers */
    loadStagePreset(presetId: string) {
      update((project) => {
        const preset = (project.stagePresets || []).find(p => p.id === presetId);
        if (!preset) return project;

        const loadedLayers = structuredClone(preset.layers);
        return { ...project, layers: loadedLayers };
      });

      // Also update VJ clip launcher's active preset reference
      vjClipLauncher.setStagePreset(presetId);
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

    /** Overwrite an existing stage preset's saved layers with the CURRENT
     * project layers (and optionally a fresh thumbnail). Used by the
     * right-click "Update Preset" action so the user can iterate on a
     * mapping without having to delete + re-save under the same name. */
    updateStagePreset(presetId: string, thumbnail?: string) {
      const currentProject = get({ subscribe });
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
          console.warn('[Store] Failed to clone layer for stage preset update:', layer.id, e);
        }
      }
      update((project) => ({
        ...project,
        stagePresets: (project.stagePresets || []).map(p =>
          p.id === presetId
            ? { ...p, layers: layersSnapshot, thumbnail: thumbnail ?? p.thumbnail, updatedAt: Date.now() }
            : p
        ),
      }));
    },

    // ========== SV Keyboard Presets ==========

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

      const composition: Composition = {
        id: compositionId,
        name,
        thumbnail,
        createdAt: Date.now(),
        layers: layersSnapshot,
        synthVision: synthVisionSnapshot,
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
     */
    loadComposition(compositionId: string) {
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

        return {
          ...project,
          layers: loadedLayers,
          vjMode: {
            ...project.vjMode,
            activeCompositionId: compositionId,
          },
        };
      });
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

      // Handle media source - strip texture and video element
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
          timelapseInterval: layer.source.timelapseInterval,
          timelapseRunning: layer.source.timelapseRunning,
          // Exclude: texture, videoElement, isPlaying
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

      // Handle text content
      if (layer.textContent) {
        exportLayer.textContent = layer.textContent;
      }

      // Handle splat content (point cloud / gaussian splat) — strip blob URLs
      if (layer.splatContent) {
        const sc = { ...layer.splatContent };
        // Strip blob URLs from filePath (point cloud data) — they die with the session
        if (sc.filePath?.startsWith('blob:')) {
          sc.filePath = (sc as any)._originalFilePath || null;
        }
        // Strip blob URLs from texturePath (video textures use blob URLs)
        if (sc.texturePath?.startsWith('blob:')) {
          (sc as any).texturePath = null;
        }
        exportLayer.splatContent = sc;
      }

      // Handle model3d content — strip blob URLs (session-only, won't work on reload).
      // Keep data URLs and file paths; clear blob URLs so they don't trigger
      // infinite fetch-fail loops on project open.
      if (layer.model3dContent) {
        const mc = { ...layer.model3dContent };
        if (mc.modelData?.startsWith('blob:')) {
          // Blob URLs die with the session. Store the original file path if we have it,
          // otherwise null it out — user will need to re-add the model file.
          mc.modelData = (mc as any)._originalFilePath || null;
        }
        exportLayer.model3dContent = mc;
      }

      return exportLayer;
    },

    /**
     * Async variant of _exportLayer that embeds blob URLs as data URLs
     * for persistent file saves. Falls back gracefully if conversion fails.
     */
    async _exportLayerForSave(layer: Layer): Promise<Record<string, unknown>> {
      const exported = this._exportLayer(layer);

      // Re-embed model3d blob URLs as base64 data URLs
      if (layer.model3dContent?.modelData?.startsWith('blob:')) {
        try {
          const dataUrl = await blobUrlToDataUrl(layer.model3dContent.modelData);
          if (dataUrl && exported.model3dContent) {
            (exported.model3dContent as any).modelData = dataUrl;
          }
        } catch (e) {
          console.warn('[exportLayerForSave] Failed to embed model data:', e);
        }
      }

      // Re-embed splat filePath blob URLs as base64 data URLs
      if (layer.splatContent?.filePath?.startsWith('blob:')) {
        try {
          const dataUrl = await blobUrlToDataUrl(layer.splatContent.filePath);
          if (dataUrl && exported.splatContent) {
            (exported.splatContent as any).filePath = dataUrl;
          }
        } catch (e) {
          console.warn('[exportLayerForSave] Failed to embed splat data:', e);
        }
      }

      // Re-embed splat texturePath blob URLs (video textures)
      if (layer.splatContent?.texturePath?.startsWith('blob:')) {
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

      // Export media library (strip runtime objects)
      const exportMedia = currentMedia.map(item => ({
        id: item.id,
        name: item.name,
        src: item.src,
        type: item.type,
        thumbnail: item.thumbnail,
        // Exclude: videoElement, texture
      }));

      // Export VJ Clip Launcher state (strip runtime objects like videoElement)
      const currentVjClipLauncher = get(vjClipLauncher);
      const exportClip = (clip: VJClip | null) => {
        if (!clip) return null;
        return {
          id: clip.id,
          type: clip.type,
          name: clip.name,
          src: clip.src,
          thumbnail: clip.thumbnail,
          shaderCode: clip.shaderCode,
          shaderValues: clip.shaderValues,
          spoutSource: clip.spoutSource,
          effectSource: clip.effectSource,
          jsAnimation: clip.jsAnimation,
          effects: clip.effects || [],
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

      // Deep clone and strip out non-serializable data
      const exportData = {
        // 1.9.0 = added macros (8 knobs + destinations + pulse), snapshots
        //         (16-slot scene bank), and launch quantization (those live
        //         outside this vjClipLauncher payload but versioned together).
        // 1.8.0 = moved bankBClipGrid INSIDE each VJBlock.
        // 1.7.0 = added Bank B deck + crossfader state at launcher root.
        version: '1.9.0',
        exportedAt: new Date().toISOString(),
        project: {
          id: currentProject.id,
          name: currentProject.name,
          width: currentProject.width,
          height: currentProject.height,
          selectedLayerId: currentProject.selectedLayerId,
          layers: currentProject.layers.map(layer => this._exportLayer(layer)),
          vjMode: exportVjMode,
          mediaFolders: normalizeMediaTrayFolders(currentProject.mediaFolders),
          stagePresets: currentProject.stagePresets || [],
          svKeyboardPresets: currentProject.svKeyboardPresets || [],
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
        // Include snapshot bank (16 captured-state slots)
        snapshots: snapshots.serialize(),
      };

      return exportData;
    },

    /**
     * Export the project as a JSON string for download.
     * Used for auto-save and real-time sync (no binary embedding).
     */
    exportProjectJSON(): string {
      const exportData = this.exportProject();
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
      syncExport.version = '1.9.0';
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
        textContent: layer.textContent || null,
        splatContent: layer.splatContent || null,
        model3dContent: layer.model3dContent || null,
        mask: layer.mask || null,
        cropRegion: layer.cropRegion || null,
        layerShape: layer.layerShape || null,
        edgeEffects: layer.edgeEffects || null,
        vjLayerIndex: layer.vjLayerIndex,
        contentFit: layer.contentFit,
        renderQuality: layer.renderQuality,
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
            vjMode?: any;
            mediaFolders?: MediaTrayFolder[];
          };
          mediaLibrary?: any[];
          vjClipLauncher?: any;
          modulation?: Array<{ key: string; mod: ParamModulation }>;
        };

        // Convert any local-filesystem path (Windows `C:\...` or Unix `/...`) to
        // a `file://` URL so it loads in browser elements like <video> /
        // <img>. Three.js loaders work with raw paths because they use fetch,
        // but the HTML media elements reject paths without a scheme.
        const pathToFileUrl = (p: string): string => {
          let urlPath = p.replace(/\\/g, '/');
          if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
          // Encode characters that are legal in paths but illegal/special in URLs
          return 'file://' + urlPath
            .replace(/%/g, '%25')
            .replace(/ /g, '%20')
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F');
        };

        // Helper: resolve relative media paths against project directory.
        // Returns a `file://` URL for any absolute filesystem path (so video /
        // image elements can load it directly).
        const resolveSrc = (src: string): string => {
          if (!src) return src;
          // Already a URL — leave as-is
          if (/^(https?:|blob:|data:|file:)/i.test(src)) return src;
          let absPath: string | null = null;
          if (/^[A-Z]:\\/i.test(src) || src.startsWith('/')) {
            absPath = src;
          } else if (projectDir) {
            const sep = projectDir.includes('\\') ? '\\' : '/';
            const base = projectDir.endsWith(sep) ? projectDir : projectDir + sep;
            absPath = base + src.replace(/^\.\//, '');
          }
          return absPath ? pathToFileUrl(absPath) : src;
        };

        if (!parsed.project) {
          console.error('Invalid project data: missing project object');
          return false;
        }

        const proj = parsed.project;

        // Import vjMode with compositions (presets)
        let importedVjMode: VJModeState | null = null;
        if (proj.vjMode) {
          const vjm = proj.vjMode;
          importedVjMode = {
            enabled: vjm.enabled || false,
            activeCompositionId: vjm.activeCompositionId || null,
            masterOpacity: vjm.masterOpacity !== undefined ? vjm.masterOpacity : 1,
            compositions: (vjm.compositions || []).map((comp: any) => ({
              id: comp.id || generateUUID(),
              name: comp.name || 'Preset',
              thumbnail: comp.thumbnail,
              createdAt: comp.createdAt || Date.now(),
              layers: (comp.layers || []).map((layer: any) => {
                const imported = this._importLayer(layer);
                if (imported.source?.src) imported.source.src = resolveSrc(imported.source.src);
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
            mediaLibrary.addItem({
              id: item.id || generateUUID(),
              name: item.name || 'Media',
              src: resolveSrc(item.src || ''),
              type: item.type || 'image',
              thumbnail: item.thumbnail,
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
            return {
              id: clip.id || generateUUID(),
              type: clip.type || 'image',
              name: clip.name || 'Clip',
              src: resolveSrc(clip.src || ''),
              thumbnail: clip.thumbnail,
              shaderCode: clip.shaderCode,
              shaderValues: clip.shaderValues || {},
              spoutSource: clip.spoutSource,
              effectSource: clip.effectSource,
              jsAnimation: clip.jsAnimation,
              effects: clip.effects || [],
              // videoElement will be recreated at runtime
            };
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
            isOpen: vjcl.isOpen || false,
            isLive: false, // Never import as live
            compositionEffects: vjcl.compositionEffects || [],
            stageMode: false, // Never import as stage mode active
            stagePresetId: vjcl.stagePresetId || null,
            stoppedAll: false,
            crossfaderEnabled: importedXfadeEnabled,
            crossfaderValue: importedXfadeValue,
            crossfaderTransition: importedXfadeTransition as any,
            crossfaderCurve: importedXfadeCurve as any,
            crossfaderBlendMode: importedXfadeBlendMode as any,
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

        // Reconstruct the project with proper defaults
        const importedProject: Project = {
          id: proj.id || generateUUID(),
          name: proj.name || 'Imported Project',
          width: proj.width || 1920,
          height: proj.height || 1080,
          selectedLayerId: proj.selectedLayerId || null,
          layers: (proj.layers || []).map(layer => {
            const imported = this._importLayer(layer);
            if (imported.source?.src) imported.source.src = resolveSrc(imported.source.src);
            return imported;
          }),
          vjMode: importedVjMode,
          mediaFolders: normalizeMediaTrayFolders(proj.mediaFolders),
          stagePresets: (proj as any).stagePresets || [],
          svKeyboardPresets: (proj as any).svKeyboardPresets || [],
        };

        set(importedProject);
        selectedLayerIdsState.set(importedProject.selectedLayerId ? [importedProject.selectedLayerId] : []);
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
);
