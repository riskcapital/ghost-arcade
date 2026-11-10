import {effectParams,effectLabels} from '../mobile/studio/interactiveEffects';
import { EDGE_STROKE_SHAPE_PARAMS, EDGE_TRIM_PARAMS, edgeTypeDef } from '../drawing/edgeEffectCatalog';
import type { Layer } from '../types';
import { effectParamLabels } from '../effects/effectUX';
import { getShaderDef } from '../renderer/gpuShaderCatalog';
import { SPLAT_AUTOMATABLE_PARAMS } from '../splat/splatParamSchema';
import { MODEL3D_AUTOMATABLE_PARAMS } from '../model3d/model3dParamSchema';
import { BLEND_MODE_ORDER } from '../types';
import { CORNER_KEYS, MESH_DISCOVERY_MAX_POINTS, blendIndex, type ParamKind } from './layerParamKeys';

export interface KeyframeableParam {
  key: string;             // track key: "shader:speed", "fx:abc:blurRadius", "fx:abc:enabled"
  label: string;           // display name
  type: 'number' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | boolean;
  group: string;           // UI grouping: "Shader", effect type name, "Edge Effects"
  /** How a line on it moves: smoothly, in whole steps (blend mode, a
   *  select), on/off, or as a colour. Unset: continuous for numbers, bool
   *  for booleans. */
  kind?: ParamKind;
}

/** The kind of a discovered parameter, filling in the default. */
export function paramKind(param: Pick<KeyframeableParam, 'type' | 'kind'>): ParamKind {
  return param.kind ?? (param.type === 'boolean' ? 'bool' : 'continuous');
}

/**
 * Discover all keyframeable parameters on a layer.
 * Returns a flat array grouped by source (shader params, each effect, edge effects).
 */
export function discoverKeyframeableParams(layer: Layer): KeyframeableParam[] {
  const params: KeyframeableParam[] = [];

  // Two effects of one style would share a group header and could not be
  // told apart, so each group carries the effect's own label.
  const interactiveEffects=layer.source?.effectSource?.interactiveScene?.effects;
  const interactiveLabels=effectLabels(Array.isArray(interactiveEffects)?interactiveEffects:[]);
  for(const effect of Array.isArray(interactiveEffects)?interactiveEffects:[]){
    const group=`Interactive · ${interactiveLabels.get(effect.id)}`;
    params.push({key:`interactive:${effect.id}:enabled`,label:'Enabled',type:'boolean',defaultValue:effect.enabled,group});
    for(const d of effectParams(effect.kind))params.push({key:`interactive:${effect.id}:${d.key}`,label:d.label,type:'number',min:d.min,max:d.max,step:d.step,defaultValue:effect.params[d.key]??d.value,group});
  }
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
          ...(input.TYPE === 'long' ? { kind: 'stepped' as const } : {}),
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
            ...(meta.type === 'select' ? { kind: 'stepped' as const } : {}),
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
      // Every numeric control of the effect's stroke, fill and animation,
      // keyed by the same dotted path the panel and modulation use.
      for (const kind of ['stroke', 'fill', 'animation'] as const) {
        const part = (edge as any)[kind] as Record<string, unknown> | undefined;
        const def = part ? edgeTypeDef(kind, String(part.type)) : undefined;
        const extra = kind === 'stroke' && part?.type !== 'none' ? EDGE_STROKE_SHAPE_PARAMS.concat(EDGE_TRIM_PARAMS) : [];
        for (const param of [...(def?.params ?? []), ...extra]) {
          if (param.kind !== 'number') continue;
          const value = part?.[param.key] ?? def?.defaults[param.key];
          params.push({
            key: `edge:${edge.id}:${kind}.${param.key}`,
            label: `${def?.label ?? kind} ${param.label}`,
            type: 'number',
            min: param.min ?? 0,
            max: param.max ?? 1,
            step: param.step ?? 0.01,
            defaultValue: typeof value === 'number' ? value : (param.min ?? 0),
            group: 'Edge Effects',
          });
        }
      }
      params.push({
        key: `edge:${edge.id}:chaseSpread`,
        label: 'Group chase delay',
        type: 'number',
        min: 0,
        max: 4,
        step: 0.05,
        defaultValue: edge.chaseSpread ?? 0.5,
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

  pushLayerExtras(layer, params);
  return params;
}

/** Visibility, blend, transform, corners, mesh, sketch, video speed and the
 *  edge Look as a whole (keys in layerParamKeys.ts). */
function pushLayerExtras(layer: Layer, params: KeyframeableParam[]): void {
  const l = layer as any;
  params.push(
    { key: 'layer:visible', label: 'Visible', type: 'boolean', kind: 'bool', defaultValue: l.visible !== false, group: 'Layer' },
    { key: 'layer:blend', label: 'Blend mode', type: 'number', kind: 'stepped', min: 0, max: BLEND_MODE_ORDER.length - 1, step: 1, defaultValue: blendIndex(l.blendMode), group: 'Layer' },
  );
  const transform = 'Transform';
  params.push(
    { key: 'transform:x', label: 'Position X', type: 'number', min: -1, max: 1, step: 0.001, defaultValue: Number(l.position?.x ?? 0), group: transform },
    { key: 'transform:y', label: 'Position Y', type: 'number', min: -1, max: 1, step: 0.001, defaultValue: Number(l.position?.y ?? 0), group: transform },
    { key: 'transform:scale', label: 'Scale', type: 'number', min: 0, max: 4, step: 0.01, defaultValue: Number(l.scale?.x ?? 1), group: transform },
    { key: 'transform:scaleX', label: 'Scale X', type: 'number', min: 0, max: 4, step: 0.01, defaultValue: Number(l.scale?.x ?? 1), group: transform },
    { key: 'transform:scaleY', label: 'Scale Y', type: 'number', min: 0, max: 4, step: 0.01, defaultValue: Number(l.scale?.y ?? 1), group: transform },
    { key: 'transform:rotation', label: 'Rotation', type: 'number', min: -180, max: 180, step: 0.1, defaultValue: Number(l.rotation ?? 0), group: transform },
  );
  if (l.corners) {
    const names: Record<string, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };
    for (const [short, field] of Object.entries(CORNER_KEYS)) {
      const corner = l.corners[field];
      if (!corner) continue;
      for (const axis of ['x', 'y'] as const) {
        params.push({
          key: `corner:${short}:${axis}`,
          label: `${names[short]} ${axis.toUpperCase()}`,
          type: 'number', min: -0.5, max: 1.5, step: 0.001,
          defaultValue: Number(corner[axis] ?? 0),
          group: 'Corners',
        });
      }
    }
  }
  const mesh = l.meshGrid;
  if (l.warpMode === 'mesh' && mesh?.points?.length && mesh.rows * mesh.cols <= MESH_DISCOVERY_MAX_POINTS) {
    mesh.points.forEach((row: any[], r: number) => row.forEach((point: any, c: number) => {
      for (const axis of ['x', 'y'] as const) {
        params.push({
          key: `mesh:${r}:${c}:${axis}`,
          label: `Point ${r + 1}·${c + 1} ${axis.toUpperCase()}`,
          type: 'number', min: -0.5, max: 1.5, step: 0.001,
          defaultValue: Number(point?.[axis] ?? 0),
          group: 'Mesh',
        });
      }
    }));
  }
  const js = l.source?.jsAnimation;
  for (const p of js?.params ?? []) {
    const current = js.paramValues?.[p.name] ?? p.default;
    if (p.type === 'number') {
      params.push({
        key: `sketch:${p.name}`, label: p.label || p.name, type: 'number',
        min: p.min ?? 0, max: p.max ?? 1, step: ((p.max ?? 1) - (p.min ?? 0)) / 100 || 0.01,
        defaultValue: typeof current === 'number' ? current : Number(p.default) || 0,
        group: 'Sketch',
      });
    } else if (p.type === 'boolean') {
      params.push({ key: `sketch:${p.name}`, label: p.label || p.name, type: 'boolean', kind: 'bool', defaultValue: !!current, group: 'Sketch' });
    }
  }
  if (l.source?.type === 'video') {
    params.push({ key: 'video:rate', label: 'Video speed', type: 'number', min: 0, max: 4, step: 0.01, defaultValue: Number(l.source.playbackRate ?? 1), group: 'Video' });
  }
  const edge = l.edgeEffects;
  if (edge?.effects?.length) {
    const group = 'Look';
    const first = edge.effects[0];
    params.push(
      { key: 'look:enabled', label: 'Look on', type: 'boolean', kind: 'bool', defaultValue: edge.enabled !== false, group },
      { key: 'look:intensity', label: 'Look intensity', type: 'number', min: 0, max: 2, step: 0.01, defaultValue: 1, group },
      { key: 'look:react', label: 'Beat reaction', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: Number(first.react?.amount ?? 0), group },
      { key: 'look:hue', label: 'Colour step per beat', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: Number(first.react?.hueStep ?? 0), group },
      { key: 'look:chase', label: 'Chase delay', type: 'number', min: 0, max: 4, step: 0.05, defaultValue: Number(first.chaseSpread ?? 0.5), group },
      { key: 'look:corner', label: 'Corner rounding', type: 'number', min: 0, max: 200, step: 1, defaultValue: Number(edge.cornerRadius ?? 0), group },
    );
  }
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
