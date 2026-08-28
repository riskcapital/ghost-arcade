import type { Layer } from '../types';
import { effectParamLabels } from '../effects/effectUX';
import { getShaderDef } from '../renderer/gpuShaderCatalog';
import { SPLAT_AUTOMATABLE_PARAMS } from '../splat/splatParamSchema';
import { MODEL3D_AUTOMATABLE_PARAMS } from '../model3d/model3dParamSchema';

export interface KeyframeableParam {
  key: string;             // track key: "shader:speed", "fx:abc:blurRadius", "fx:abc:enabled"
  label: string;           // display name
  type: 'number' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | boolean;
  group: string;           // UI grouping: "Shader", effect type name, "Edge Effects"
}

/**
 * Discover all keyframeable parameters on a layer.
 * Returns a flat array grouped by source (shader params, each effect, edge effects).
 */
export function discoverKeyframeableParams(layer: Layer): KeyframeableParam[] {
  const params: KeyframeableParam[] = [];

  // ── Shader parameters ──
  if (layer.source?.shaderInputs) {
    for (const input of layer.source.shaderInputs) {
      if (input.TYPE === 'float' || input.TYPE === 'long') {
        params.push({
          key: `shader:${input.NAME}`,
          label: input.LABEL || input.NAME,
          type: 'number',
          min: input.MIN ?? 0,
          max: input.MAX ?? 1,
          step: input.TYPE === 'long' ? 1 : 0.01,
          defaultValue: (typeof input.DEFAULT === 'number' ? input.DEFAULT : 0),
          group: 'Shader',
        });
      }
    }
  }

  // ── Layer opacity ──
  params.push({
    key: 'layer:opacity',
    label: 'Opacity',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: layer.opacity ?? 1,
    group: 'Layer',
  });

  // ── 3D Model parameters ──
  // Use dot-paths after the "model3d:" prefix for nested fields (echo.count, camera.fov).
  if (layer.type === 'model3d' && layer.model3dContent) {
    const mc: any = layer.model3dContent;
    for (const def of MODEL3D_AUTOMATABLE_PARAMS) {
      const cur = readDotPath(mc, def.key);
      params.push({
        key: `model3d:${def.key}`,
        label: def.label,
        type: 'number',
        min: def.min,
        max: def.max,
        step: def.step,
        defaultValue: typeof cur === 'number' ? cur : 0,
        group: def.group,
      });
    }
  }

  if (layer.type === 'splat' && layer.splatContent) {
    const content = layer.splatContent as unknown as Record<string, unknown>;
    for (const def of SPLAT_AUTOMATABLE_PARAMS) {
      const value = content[def.key];
      params.push({
        key: `splat:${def.key}`,
        label: def.label,
        type: 'number',
        min: def.min,
        max: def.max,
        step: def.step,
        defaultValue: typeof value === 'number' ? value : def.min,
        group: `Splat · ${def.group}`,
      });
    }
  }

  // ── Effects ──
  if (layer.effects) {
    for (const effect of layer.effects) {
      const labels = effectParamLabels[effect.type];
      const groupName = effect.type.charAt(0).toUpperCase() + effect.type.slice(1);

      // Effect enabled toggle
      params.push({
        key: `fx:${effect.id}:enabled`,
        label: 'Enabled',
        type: 'boolean',
        defaultValue: effect.enabled,
        group: groupName,
      });

      // Effect opacity
      params.push({
        key: `fx:${effect.id}:opacity`,
        label: 'Opacity',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: effect.opacity ?? 1,
        group: groupName,
      });

      // Effect-specific params (use effectParamLabels which matches the LayerPanel UI)
      if (labels) {
        for (const [paramKey, meta] of Object.entries(labels)) {
          if (meta.type === 'color') continue; // Skip color pickers
          params.push({
            key: `fx:${effect.id}:${paramKey}`,
            label: meta.label,
            type: 'number',
            min: meta.min,
            max: meta.max,
            step: meta.step,
            defaultValue: meta.default,
            group: groupName,
          });
        }
      }
    }
  }

  // ── Edge effects ──
  if (layer.edgeEffects?.effects) {
    for (const edge of layer.edgeEffects.effects) {
      params.push({
        key: `edge:${edge.id}:enabled`,
        label: 'Enabled',
        type: 'boolean',
        defaultValue: edge.enabled,
        group: 'Edge Effects',
      });
      params.push({
        key: `edge:${edge.id}:opacity`,
        label: 'Opacity',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: edge.opacity ?? 1,
        group: 'Edge Effects',
      });
    }
  }

  // ── GPU layer (planet, pixel-particles, future shaders) ──
  // Track keys use the `gpu:` prefix that the Canvas keyframe
  // override loop already understands. Schema is pulled from the
  // shader's catalog entry so any new shader's params become
  // keyframable automatically — no per-shader plumbing required.
  if (layer.type === 'gpu' && layer.gpuLayerContent) {
    const def = getShaderDef(layer.gpuLayerContent.shaderId);
    if (def) {
      const shaderName = def.label;
      for (const p of def.paramSchema) {
        // Numeric keyframe tracks: slider + angle.
        if (p.kind === 'slider') {
          const cur = layer.gpuLayerContent.params[p.key] ?? p.default;
          params.push({
            key: `gpu:${p.key}`,
            label: p.label,
            type: 'number',
            min: p.min,
            max: p.max,
            step: p.step,
            defaultValue: typeof cur === 'number' ? cur : p.default,
            group: p.group ? `${shaderName} · ${p.group}` : shaderName,
          });
        } else if (p.kind === 'angle') {
          const cur = layer.gpuLayerContent.params[p.key] ?? p.default;
          params.push({
            key: `gpu:${p.key}`,
            label: p.label,
            type: 'number',
            min: -180,
            max: 360,
            step: 0.5,
            defaultValue: typeof cur === 'number' ? cur : p.default,
            group: p.group ? `${shaderName} · ${p.group}` : shaderName,
          });
        } else if (p.kind === 'toggle') {
          const cur = layer.gpuLayerContent.params[p.key] ?? p.default;
          params.push({
            key: `gpu:${p.key}`,
            label: p.label,
            type: 'boolean',
            defaultValue: typeof cur === 'boolean' ? cur : p.default,
            group: p.group ? `${shaderName} · ${p.group}` : shaderName,
          });
        }
        // 'select', 'color', and 'media-source' are not keyframable
        // (string / array / object values aren't smoothly interpolatable
        // and their identity changes are typically discrete events).
      }
    }
  }

  return params;
}

// Read a nested object property by dot path (e.g. "echo.count" → obj.echo?.count).
function readDotPath(obj: any, path: string): any {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}
