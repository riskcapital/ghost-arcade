/**
 * Director Tool Executor — Maps AI tool calls to store method invocations.
 *
 * Each tool call from the LLM is a { name, input } pair. This module
 * resolves the tool name, executes the corresponding store operations,
 * and returns a human-readable result string.
 */

import { get } from 'svelte/store';
import { project } from '$lib/stores/layers';
import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
import { generateUUID } from '$lib/types';
import type { DirectorToolCall, DirectorToolResult } from './types';
import { buildStateSnapshot } from './DirectorStateSnapshot';

// Lazy-load thumbnail generator (async, doesn't block tool execution)
let thumbnailGenerator: ((code: string, time?: number) => Promise<string>) | null = null;
async function getThumbnailGenerator() {
  if (!thumbnailGenerator) {
    const mod = await import('$lib/isf/thumbnail');
    thumbnailGenerator = mod.generateCachedThumbnail;
  }
  return thumbnailGenerator;
}

/** Fire-and-forget: generate thumbnail for a VJ clip after it's been set */
function generateClipThumbnail(layerIdx: number, colIdx: number, shaderCode: string) {
  getThumbnailGenerator().then(gen => gen(shaderCode, 0.5)).then(thumb => {
    if (!thumb) return;
    // Update the clip in the store with the thumbnail
    vjClipLauncher.update((state: any) => {
      const grid = state.clipGrid.map((row: any[], ri: number) =>
        row.map((clip: any, ci: number) => {
          if (ri === layerIdx && ci === colIdx && clip) {
            return { ...clip, thumbnail: thumb };
          }
          return clip;
        })
      );
      return { ...state, clipGrid: grid };
    });
  }).catch(() => {});
}

// ─── Helper: resolve a layer reference (name or index) to a layer object ────

function resolveLayer(ref: string): { id: string; name: string; index: number } | null {
  const layers = get(project).layers;
  // Try by index
  const idx = parseInt(ref, 10);
  if (!isNaN(idx) && idx >= 0 && idx < layers.length) {
    return { id: layers[idx].id, name: layers[idx].name, index: idx };
  }
  // Try by name (case-insensitive partial match)
  const lower = ref.toLowerCase();
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].name.toLowerCase().includes(lower)) {
      return { id: layers[i].id, name: layers[i].name, index: i };
    }
  }
  // Try by ID
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].id === ref) {
      return { id: layers[i].id, name: layers[i].name, index: i };
    }
  }
  return null;
}

// ─── Tool Handlers ──────────────────────────────────────────────────────────

const toolHandlers: Record<string, (input: Record<string, any>) => string> = {

  get_app_state(_input) {
    const state = buildStateSnapshot();
    return JSON.stringify(state, null, 1);
  },

  create_layer(input) {
    // If a shader is specified, force type to 'media' regardless of what
    // the LLM requested — only media layers can display shaders.
    const shader = input.shader;
    const type = shader ? 'media' : (input.type || 'media');
    const name = input.name;

    // Use the same layer creation methods the UI uses.
    switch (type) {
      case 'media': project.addLayer('media'); break;
      case 'text': project.addTextLayer(); break;
      case 'color': project.addColorLayer(); break;
      case 'lines': project.addLinesLayer(); break;
      case 'svg': project.addSVGLayer(); break;
      case 'lightpainting': project.addLightPaintingLayer(); break;
      case 'splat': project.addSplatLayer(); break;
      case 'model3d': project.addModel3DLayer(); break;
      default: project.addLayer('media');
    }

    // New layers prepend to top = index 0
    const layers = get(project).layers;
    const created = layers[0];
    if (!created) return 'Failed to create layer';

    if (name) project.updateLayer(created.id, { name });

    // If a shader was specified, schedule assignment after a microtask so the
    // auto-default-shader from addLayer('media') has time to finish. The
    // assign_shader call will overwrite whatever the auto-shader set.
    if (shader && type === 'media') {
      const layerId = created.id;
      setTimeout(() => {
        toolHandlers.assign_shader({ layer: layerId, shader });
      }, 100);
      return `Created ${type} layer "${name || created.name}" (id: ${created.id}) — assigning shader "${shader}"`;
    }

    return `Created ${type} layer "${name || created.name}" (id: ${created.id})`;
  },

  remove_layer(input) {
    const ref = resolveLayer(input.layer);
    if (!ref) return `Layer "${input.layer}" not found`;
    project.removeLayer(ref.id);
    return `Removed layer "${ref.name}"`;
  },

  assign_shader(input) {
    const ref = resolveLayer(input.layer);
    if (!ref) return `Layer "${input.layer}" not found`;

    const shaderName = input.shader || '';

    // Search the preloaded shader cache for a match
    const cache = (window as any).__shaderCache;
    if (!cache?.shaders) return 'Shader library not loaded yet. Wait for shaders to finish loading.';

    const shaders = cache.shaders as Array<any>;
    const lower = shaderName.toLowerCase();

    // Find best match
    let match = shaders.find((s: any) => s.name.toLowerCase() === lower);
    if (!match) match = shaders.find((s: any) => s.name.toLowerCase().includes(lower));
    if (!match) match = shaders.find((s: any) => s.id.toLowerCase().includes(lower));

    if (!match) return `No shader found matching "${shaderName}". Try search_shaders to find available shaders.`;

    // Build media source using the SAME structure the UI uses when a user
    // clicks a shader in MediaTray. The critical fields are shaderCode,
    // shaderInputs (parsed ISF inputs), and shaderValues (default param values).
    const shaderInputs = match.inputs || [];
    const shaderValues: Record<string, any> = {};
    const imageInputRefs: Record<string, null> = {};

    for (const inp of shaderInputs) {
      if (inp.TYPE === 'image') {
        imageInputRefs[inp.NAME] = null;
      } else if (match.values && match.values[inp.NAME] !== undefined) {
        // Use cached default values (includes manifest overrides)
        shaderValues[inp.NAME] = match.values[inp.NAME];
      } else if (inp.DEFAULT !== undefined) {
        shaderValues[inp.NAME] = inp.DEFAULT;
      }
    }

    const source = {
      id: match.id || generateUUID(),
      type: 'shader' as const,
      src: match.src || 'preloaded',
      name: match.name,
      shaderCode: match.shaderCode,
      shaderInputs,
      shaderValues,
      shaderImageInputs: imageInputRefs,
    };

    project.setLayerSource(ref.id, source as any);
    return `Assigned shader "${match.name}" to layer "${ref.name}"`;
  },

  set_layer_properties(input) {
    const ref = resolveLayer(input.layer);
    if (!ref) return `Layer "${input.layer}" not found`;

    const updates: Record<string, any> = {};
    if (input.opacity !== undefined) updates.opacity = Math.max(0, Math.min(1, input.opacity));
    if (input.visible !== undefined) updates.visible = input.visible;
    if (input.blendMode !== undefined) updates.blendMode = input.blendMode;
    if (input.name !== undefined) updates.name = input.name;

    if (Object.keys(updates).length > 0) {
      project.updateLayer(ref.id, updates);
    }

    const props = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ');
    return `Updated layer "${ref.name}": ${props}`;
  },

  set_layer_position(input) {
    const ref = resolveLayer(input.layer);
    if (!ref) return `Layer "${input.layer}" not found`;

    if (input.topLeft) project.setCorner(ref.id, 'topLeft', input.topLeft);
    if (input.topRight) project.setCorner(ref.id, 'topRight', input.topRight);
    if (input.bottomLeft) project.setCorner(ref.id, 'bottomLeft', input.bottomLeft);
    if (input.bottomRight) project.setCorner(ref.id, 'bottomRight', input.bottomRight);

    return `Set corner positions for layer "${ref.name}"`;
  },

  add_effect(input) {
    const ref = resolveLayer(input.layer);
    if (!ref) return `Layer "${input.layer}" not found`;

    const effectType = input.effectType || 'blur';
    project.addEffect(ref.id, effectType);
    return `Added ${effectType} effect to layer "${ref.name}"`;
  },

  search_shaders(input) {
    const cache = (window as any).__shaderCache;
    if (!cache?.shaders) return 'Shader library not loaded yet.';

    const shaders = cache.shaders as Array<{ id: string; name: string; category?: string; description?: string }>;
    const query = (input.query || '').toLowerCase();
    const category = (input.category || '').toLowerCase();
    const excludeUtility = input.excludeUtility !== false; // default true

    // Utility/test shaders to exclude from VJ recommendations
    const utilityNames = ['testpattern', 'gridmatrix', 'uvgrid', 'safearea', 'centercrosshair', 'solidcolor', 'testbars'];

    let results = shaders;
    if (excludeUtility) {
      results = results.filter(s => !utilityNames.some(u => s.name.toLowerCase().includes(u)));
    }
    if (category) {
      results = results.filter(s => (s.category || '').toLowerCase().includes(category));
    }
    if (query && query !== 'all' && query !== '*') {
      results = results.filter(s =>
        s.name.toLowerCase().includes(query) ||
        (s.description || '').toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query)
      );
    }

    const top = results.slice(0, 30);
    if (top.length === 0) return `No shaders found matching "${input.query}"${category ? ` in category "${input.category}"` : ''}`;

    return `Found ${results.length} shaders${results.length > 30 ? ' (showing first 30)' : ''}:\n` +
      top.map(s => `- ${s.name}${s.category ? ` [${s.category}]` : ''}`).join('\n');
  },

  assign_vj_clip(input) {
    const layerIdx = parseInt(input.layer, 10);
    const colIdx = parseInt(input.column, 10);
    if (isNaN(layerIdx) || isNaN(colIdx)) return 'Invalid layer or column index';

    const shaderName = input.source || input.shader || '';
    if (!shaderName) return 'No shader/source specified';

    // Find shader in cache
    const cache = (window as any).__shaderCache;
    if (!cache?.shaders) return 'Shader library not loaded yet.';
    const shaders = cache.shaders as Array<any>;
    const lower = shaderName.toLowerCase();
    let match = shaders.find((s: any) => s.name.toLowerCase() === lower);
    if (!match) match = shaders.find((s: any) => s.name.toLowerCase().includes(lower));
    if (!match) return `No shader found matching "${shaderName}"`;

    // Build VJ clip from shader (same structure as VJModePanel drag-drop)
    const clip = {
      id: generateUUID(),
      type: 'shader' as const,
      name: match.name,
      src: match.src || 'preloaded',
      shaderCode: match.shaderCode,
      shaderValues: {} as Record<string, any>,
      thumbnail: '',
    };

    // Set default values
    if (match.inputs) {
      for (const inp of match.inputs) {
        if (inp.TYPE !== 'image' && match.values?.[inp.NAME] !== undefined) {
          clip.shaderValues[inp.NAME] = match.values[inp.NAME];
        } else if (inp.DEFAULT !== undefined && inp.TYPE !== 'image') {
          clip.shaderValues[inp.NAME] = inp.DEFAULT;
        }
      }
    }

    vjClipLauncher.setClip(layerIdx, colIdx, clip as any);
    // Generate thumbnail in background (fire-and-forget)
    generateClipThumbnail(layerIdx, colIdx, match.shaderCode);
    return `Assigned "${match.name}" to VJ grid [layer ${layerIdx}, column ${colIdx}]`;
  },

  trigger_vj_clip(input) {
    const layerIdx = input.layer !== undefined ? parseInt(input.layer, 10) : undefined;
    const colIdx = parseInt(input.column, 10);
    if (isNaN(colIdx)) return 'Invalid column index';

    if (layerIdx !== undefined && !isNaN(layerIdx)) {
      vjClipLauncher.triggerClip(layerIdx, colIdx);
      return `Triggered clip at [layer ${layerIdx}, column ${colIdx}]`;
    } else {
      vjClipLauncher.triggerColumn(colIdx);
      return `Triggered all clips in column ${colIdx}`;
    }
  },

  set_vj_layer_props(input) {
    const layerIdx = parseInt(input.layer, 10);
    if (isNaN(layerIdx)) return 'Invalid layer index';

    if (input.opacity !== undefined) vjClipLauncher.setLayerOpacity(layerIdx, input.opacity);
    if (input.blendMode) vjClipLauncher.setLayerBlendMode(layerIdx, input.blendMode);
    if (input.solo !== undefined) vjClipLauncher.toggleLayerSolo(layerIdx);
    if (input.mute !== undefined) vjClipLauncher.toggleLayerMute(layerIdx);

    return `Updated VJ layer ${layerIdx} properties`;
  },

  vj_mixer_control(input) {
    if (input.masterOpacity !== undefined) vjClipLauncher.setMasterOpacity(input.masterOpacity);
    if (input.stopAll) vjClipLauncher.stopAll();
    if (input.live !== undefined) vjClipLauncher.setLive(input.live);
    return `VJ mixer updated`;
  },

  setup_vj_mode(input) {
    if (input.enabled) {
      vjClipLauncher.setOpen(true);
      vjClipLauncher.setLive(true);
    } else {
      vjClipLauncher.setOpen(false);
      vjClipLauncher.setLive(false);
    }

    if (input.layers && input.layers > 0) {
      const current = get(vjClipLauncher).numLayers;
      const diff = input.layers - current;
      for (let i = 0; i < diff; i++) vjClipLauncher.addLayer();
      for (let i = 0; i < -diff; i++) vjClipLauncher.removeLayer();
    }

    if (input.columns && input.columns > 0) {
      const current = get(vjClipLauncher).numColumns;
      const diff = input.columns - current;
      for (let i = 0; i < diff; i++) vjClipLauncher.addColumn();
      for (let i = 0; i < -diff; i++) vjClipLauncher.removeColumn();
    }

    return `VJ mode ${input.enabled ? 'enabled' : 'disabled'}. Grid: ${get(vjClipLauncher).numLayers} layers × ${get(vjClipLauncher).numColumns} columns`;
  },

  batch_operations(input) {
    const ops = input.operations || [];
    const results: string[] = [];

    for (const op of ops) {
      const handler = toolHandlers[op.tool];
      if (!handler) {
        results.push(`Unknown tool: ${op.tool}`);
        continue;
      }
      try {
        const result = handler(op.input || {});
        results.push(`${op.tool}: ${result}`);
      } catch (err) {
        results.push(`${op.tool}: Error — ${(err as Error).message}`);
      }
    }

    return `Executed ${ops.length} operations:\n${results.join('\n')}`;
  },
};

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function executeToolCall(toolCall: DirectorToolCall): Promise<DirectorToolResult> {
  const handler = toolHandlers[toolCall.name];

  if (!handler) {
    return {
      toolCallId: toolCall.id,
      content: `Unknown tool: ${toolCall.name}`,
      isError: true,
    };
  }

  try {
    const result = handler(toolCall.input);
    return {
      toolCallId: toolCall.id,
      content: result,
    };
  } catch (err) {
    return {
      toolCallId: toolCall.id,
      content: `Tool "${toolCall.name}" failed: ${(err as Error).message}`,
      isError: true,
    };
  }
}
