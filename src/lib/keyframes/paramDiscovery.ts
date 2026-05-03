import type { Layer } from '../types';
import { effectParamLabels } from '../effects/effectUX';

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
    const m3d: { path: string; label: string; min: number; max: number; step: number; group: string }[] = [
      // Transform
      { path: 'scaleUniform',  label: 'Scale',         min: 0.01, max: 10,  step: 0.01, group: '3D Transform' },
      { path: 'rotationX',     label: 'Rotation X',    min: -360, max: 360, step: 1,    group: '3D Transform' },
      { path: 'rotationY',     label: 'Rotation Y',    min: -360, max: 360, step: 1,    group: '3D Transform' },
      { path: 'rotationZ',     label: 'Rotation Z',    min: -360, max: 360, step: 1,    group: '3D Transform' },
      { path: 'positionX',     label: 'Position X',    min: -5,   max: 5,   step: 0.01, group: '3D Transform' },
      { path: 'positionY',     label: 'Position Y',    min: -5,   max: 5,   step: 0.01, group: '3D Transform' },
      { path: 'positionZ',     label: 'Position Z',    min: -5,   max: 5,   step: 0.01, group: '3D Transform' },
      // Camera
      { path: 'camera.fov',         label: 'FOV',           min: 10,   max: 120, step: 1,    group: '3D Camera' },
      { path: 'camera.distance',    label: 'Distance',      min: 0.5,  max: 30,  step: 0.1,  group: '3D Camera' },
      { path: 'camera.orbitX',      label: 'Orbit X',       min: -90,  max: 90,  step: 1,    group: '3D Camera' },
      { path: 'camera.orbitY',      label: 'Orbit Y',       min: -360, max: 360, step: 1,    group: '3D Camera' },
      { path: 'camera.panX',        label: 'Pan X',         min: -5,   max: 5,   step: 0.01, group: '3D Camera' },
      { path: 'camera.panY',        label: 'Pan Y',         min: -5,   max: 5,   step: 0.01, group: '3D Camera' },
      { path: 'camera.roll',        label: 'Roll',          min: -180, max: 180, step: 1,    group: '3D Camera' },
      { path: 'camera.rotateSpeed', label: 'Auto-Rotate Speed', min: -5, max: 5, step: 0.01, group: '3D Camera' },
      // Deformation
      { path: 'deformationIntensity', label: 'Deform Intensity', min: 0,   max: 2,  step: 0.01, group: '3D Deformation' },
      { path: 'deformationSpeed',     label: 'Deform Speed',     min: 0,   max: 5,  step: 0.01, group: '3D Deformation' },
      { path: 'deformationScale',     label: 'Deform Scale',     min: 0.1, max: 10, step: 0.05, group: '3D Deformation' },
      { path: 'deformationSpread',    label: 'Deform Spread',    min: 0,   max: 6,  step: 0.05, group: '3D Deformation' },
      // Animation
      { path: 'animationSpeed',     label: 'Anim Speed',     min: 0, max: 5, step: 0.01, group: '3D Animation' },
      { path: 'animationIntensity', label: 'Anim Intensity', min: 0, max: 2, step: 0.01, group: '3D Animation' },
      { path: 'animationProgress',  label: 'Anim Progress',  min: 0, max: 1, step: 0.001, group: '3D Animation' },
      // Echo
      { path: 'echo.count',             label: 'Echo Count',         min: 1, max: 30, step: 1,    group: '3D Echo' },
      { path: 'echo.spacing',           label: 'Echo Spacing',       min: 0, max: 2,  step: 0.01, group: '3D Echo' },
      { path: 'echo.fadeRate',          label: 'Echo Fade',          min: 0, max: 3,  step: 0.01, group: '3D Echo' },
      { path: 'echo.scaleVariation',    label: 'Echo Scale Var',     min: 0, max: 1,  step: 0.01, group: '3D Echo' },
      { path: 'echo.rotationVariation', label: 'Echo Rotation Var',  min: 0, max: 1,  step: 0.01, group: '3D Echo' },
      { path: 'echo.colorVariation',    label: 'Echo Color Var',     min: 0, max: 1,  step: 0.01, group: '3D Echo' },
      { path: 'echo.phaseOffset',       label: 'Echo Phase Offset',  min: 0, max: 2,  step: 0.01, group: '3D Echo' },
      { path: 'echo.speed',             label: 'Echo Speed',         min: 0, max: 5,  step: 0.01, group: '3D Echo' },
      // Material
      { path: 'materialOpacity',           label: 'Mat Opacity',    min: 0, max: 1, step: 0.01, group: '3D Material' },
      { path: 'materialRoughness',         label: 'Roughness',      min: 0, max: 1, step: 0.01, group: '3D Material' },
      { path: 'materialMetalness',         label: 'Metalness',      min: 0, max: 1, step: 0.01, group: '3D Material' },
      { path: 'materialEmissiveIntensity', label: 'Emissive',       min: 0, max: 5, step: 0.01, group: '3D Material' },
      { path: 'glassThickness',            label: 'Glass Thickness', min: 0,  max: 5, step: 0.01, group: '3D Material' },
      { path: 'glassIOR',                  label: 'Glass IOR',       min: 1,  max: 3, step: 0.01, group: '3D Material' },
      { path: 'chromeReflectivity',        label: 'Chrome Reflect',  min: 0,  max: 1, step: 0.01, group: '3D Material' },
      { path: 'dissolveAmount',            label: 'Dissolve',        min: 0,  max: 1, step: 0.01, group: '3D Material' },
      // Lighting
      { path: 'ambientIntensity',     label: 'Ambient',     min: 0, max: 2, step: 0.01, group: '3D Lighting' },
      { path: 'directionalIntensity', label: 'Directional', min: 0, max: 3, step: 0.01, group: '3D Lighting' },
      // Wireframe / Decorations
      { path: 'wireframeOpacity',     label: 'Wireframe Opacity', min: 0, max: 1, step: 0.01, group: '3D Style' },
      { path: 'wireframeAnimSpeed',   label: 'Wireframe Speed',   min: 0, max: 5, step: 0.01, group: '3D Style' },
      { path: 'vertexDecorationSize', label: 'Vertex Deco Size',  min: 0.001, max: 0.5, step: 0.001, group: '3D Style' },
      // Audio reactivity
      { path: 'audio.scaleResponse',     label: 'Audio→Scale',     min: 0, max: 5, step: 0.01, group: '3D Audio' },
      { path: 'audio.rotationResponse',  label: 'Audio→Rotation',  min: 0, max: 5, step: 0.01, group: '3D Audio' },
      { path: 'audio.deformResponse',    label: 'Audio→Deform',    min: 0, max: 5, step: 0.01, group: '3D Audio' },
      // Beat sync
      { path: 'beatScale',   label: 'Beat Scale',   min: 0, max: 2, step: 0.01, group: '3D Beat' },
      { path: 'beatRotate',  label: 'Beat Rotate',  min: 0, max: 2, step: 0.01, group: '3D Beat' },
      { path: 'beatExplode', label: 'Beat Explode', min: 0, max: 2, step: 0.01, group: '3D Beat' },
    ];

    for (const def of m3d) {
      const cur = readDotPath(mc, def.path);
      params.push({
        key: `model3d:${def.path}`,
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
