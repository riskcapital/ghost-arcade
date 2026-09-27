// Edge Effects: the style and geometry contract shared by the native render
// core and the legacy WebGL editor renderer (RenderEngine.renderLayerEdgeEffects,
// still used by web builds). Everything that decides what an edge effect
// looks like lives here, so the projector cannot drift from the design.

import type { EdgeEffect, EdgeEffectsConfig, Layer, Point2D } from '../types';
import { getShapeVertices } from '../types';
import { evaluateMeshGrid, layerRenderMeshGrid } from '../utils/meshWarp';
import { DEFAULT_DRAWING_STYLE, resolveDrawingStyle, type DrawingStyle } from './drawingStyle';
import { edgeTypeDef, isKnownEdgeType } from './edgeEffectCatalog';
import { buildEdgeOutline, layerUvToOutput, type EdgeOutline } from './edgeEffectGeometry';
import type { Animation, Fill, Stroke } from './types';

/** Enabled edge effects rendered per layer, by the editor and the native core. */
export const EDGE_EFFECT_LIMIT = 16;
/** Outline vertices the legacy WebGL shape shader takes (uCustomVertices[64]). */
export const EDGE_OUTLINE_MAX_POINTS = 64;
/** The stroke sits this many output pixels inside the layer outline. */
const EDGE_INSET_PX = 5;

export function edgeEffectLimitWarning(effects: readonly { enabled?: boolean }[] = []): string | null {
  const enabled = effects.filter((effect) => effect && effect.enabled !== false).length;
  if (enabled <= EDGE_EFFECT_LIMIT) return null;
  const extra = enabled - EDGE_EFFECT_LIMIT;
  return `Only the first ${EDGE_EFFECT_LIMIT} enabled edge effects render. ${extra} extra effect${extra === 1 ? ' is' : 's are'} bypassed; disable or remove earlier effects to use them.`;
}

/** The effects that render, in order: enabled ones, capped at the limit. */
export function renderedEdgeEffects(config: EdgeEffectsConfig | null | undefined): EdgeEffect[] {
  if (!config?.enabled || !Array.isArray(config.effects)) return [];
  return config.effects.filter((effect) => effect && effect.enabled !== false).slice(0, EDGE_EFFECT_LIMIT);
}

const finite = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Translate an edge effect's stored fill, stroke and animation into the
 * objects the shape shader resolver reads. The Edge Effects panel stores a
 * few parameters under names or shapes the drawing renderer never read
 * (scanner `trailLength`, holographic `hueShift`, gradient `stops`, solid
 * fill `opacity`, pulse `pulseCount`/`fadeLength`); they are mapped here so
 * each slider changes the picture in both renderers. For the WebGL
 * renderer, types it cannot draw become none; the native core draws all.
 */
export function normalizeEdgeEffectStyle(
  effect: Pick<EdgeEffect, 'fill' | 'stroke' | 'animation'>,
  target: 'webgl' | 'native' = 'webgl',
): { fill: Fill; stroke: Stroke; animation: Animation } {
  const stroke: any = { ...(effect.stroke ?? { type: 'none' }) };
  let fill: any = { ...(effect.fill ?? { type: 'none' }) };
  let animation: any = { ...(effect.animation ?? { type: 'none' }) };

  switch (stroke.type) {
    case 'scanner':
      if (!('trail' in stroke) && 'trailLength' in stroke) stroke.trail = stroke.trailLength;
      break;
    case 'pulse': {
      // Evenly spaced pulses travelling the outline: the snake renderer with
      // one snake per pulse, each fadeLength of the path long.
      stroke.snakeCount = Math.max(1, Math.min(8, Math.round(finite(stroke.pulseCount, 3))));
      if (!('length' in stroke)) stroke.length = finite(stroke.fadeLength, 0.15);
      if (stroke.direction === 'backward') stroke.speed = -finite(stroke.speed, 1);
      break;
    }
    case 'dashed':
    case 'dotted':
      if (stroke.type === 'dotted') {
        if (!('dashLength' in stroke) && 'dotSize' in stroke) stroke.dashLength = stroke.dotSize;
        if (!('gapLength' in stroke) && 'spacing' in stroke) stroke.gapLength = stroke.spacing;
      }
      if (!('speed' in stroke) && ('animated' in stroke || 'animationSpeed' in stroke)) {
        stroke.speed = stroke.animated === false ? 0 : finite(stroke.animationSpeed, 1);
      }
      break;
    case 'snake':
      if ('snakeCount' in stroke) stroke.snakeCount = Math.max(1, Math.min(8, Math.round(finite(stroke.snakeCount, 1))));
      break;
    default:
      break;
  }
  const strokeDef = edgeTypeDef('stroke', stroke.type);
  if (!isKnownEdgeType('stroke', stroke.type) || stroke.type === 'video' || (target === 'webgl' && strokeDef && !strokeDef.webgl)) {
    return normalizeEdgeEffectStyle({ ...effect, stroke: { type: 'none' } }, target);
  }

  switch (fill.type) {
    case 'solid': {
      const color = Array.isArray(fill.color) ? fill.color : [1, 1, 1, 1];
      const opacity = Math.max(0, Math.min(1, finite(fill.opacity, 1)));
      fill.color = [color[0], color[1], color[2], finite(color[3], 1) * opacity];
      break;
    }
    case 'gradient':
    case 'radialGradient': {
      const stops = Array.isArray(fill.stops) ? fill.stops : [];
      if (!('color' in fill) && stops.length) fill.color = stops[0]?.color;
      if (!('color2' in fill) && stops.length) fill.color2 = stops[stops.length - 1]?.color;
      if (fill.type === 'radialGradient') {
        fill.gradientType = 'radial';
        fill.type = 'gradient';
      }
      // Stored in degrees (GradientFill.angle); the shader takes radians.
      if ('angle' in fill) fill.angle = finite(fill.angle, 0) * Math.PI / 180;
      if (!('speed' in fill) && ('animated' in fill || 'animationSpeed' in fill)) {
        fill.speed = fill.animated ? finite(fill.animationSpeed, 1) : 0;
      }
      break;
    }
    case 'holographic':
      if (!('shiftAmount' in fill) && 'hueShift' in fill) fill.shiftAmount = fill.hueShift;
      break;
    case 'noise':
      if (!('speed' in fill) && ('animated' in fill || 'animationSpeed' in fill)) {
        fill.speed = fill.animated ? finite(fill.animationSpeed, 1) : 0;
      }
      break;
    default:
      break;
  }
  const fillDef = edgeTypeDef('fill', fill.type);
  if (!isKnownEdgeType('fill', fill.type) || fill.type === 'video' || (target === 'webgl' && fillDef && !fillDef.webgl)) {
    fill = { type: 'none' };
  }

  const animationDef = edgeTypeDef('animation', animation.type);
  if (!animationDef || (target === 'webgl' && !animationDef.webgl)) animation = { type: 'none' };
  return { fill, stroke, animation };
}

/** Resolved shape-shader values of one edge effect (fields it lacks take defaults). */
export function edgeEffectStyle(effect: Pick<EdgeEffect, 'fill' | 'stroke' | 'animation'>, target: 'webgl' | 'native' = 'webgl'): DrawingStyle {
  return resolveDrawingStyle(normalizeEdgeEffectStyle(effect, target), DEFAULT_DRAWING_STYLE);
}

/**
 * The legacy WebGL renderer's outline, in output UV (0-1, y up): the layer
 * shape through the mesh and corner warp, each vertex pulled EDGE_INSET_PX
 * toward the centroid, decimated to the shader's 64 vertex slots.
 */
export function edgeEffectOutline(
  layer: Pick<Layer, 'layerShape' | 'corners' | 'warpMode' | 'meshGrid'>,
  width: number,
  height: number,
): Point2D[] {
  let uvVertices = layer.layerShape && layer.layerShape.enabled !== false
    ? getShapeVertices(layer.layerShape)
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  if (uvVertices.length < 3 || !layer.corners) return [];
  const mesh = layerRenderMeshGrid(layer);
  if (mesh) {
    const perEdge = Math.max(1, Math.floor(EDGE_OUTLINE_MAX_POINTS / uvVertices.length));
    const dense: Point2D[] = [];
    uvVertices.forEach((a, i) => {
      const b = uvVertices[(i + 1) % uvVertices.length];
      for (let s = 0; s < perEdge; s++) dense.push({ x: a.x + (b.x - a.x) * s / perEdge, y: a.y + (b.y - a.y) * s / perEdge });
    });
    uvVertices = dense.map((uv) => evaluateMeshGrid(mesh, uv.x, uv.y));
  }
  const c = layer.corners;
  const screen = uvVertices.map((uv) => {
    const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * uv.x;
    const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * uv.x;
    const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * uv.x;
    const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * uv.x;
    return { x: botX + (topX - botX) * uv.y, y: botY + (topY - botY) * uv.y };
  });
  const cx = screen.reduce((s, v) => s + v.x, 0) / screen.length;
  const cy = screen.reduce((s, v) => s + v.y, 0) / screen.length;
  const w = width || 1920;
  const h = height || 1080;
  const inset = screen.map((v) => {
    const dxPx = (cx - v.x) * w;
    const dyPx = (cy - v.y) * h;
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx) || 1;
    return { x: v.x + (dxPx / lenPx) * EDGE_INSET_PX / w, y: v.y + (dyPx / lenPx) * EDGE_INSET_PX / h };
  });
  if (inset.length <= EDGE_OUTLINE_MAX_POINTS) return inset;
  const step = inset.length / EDGE_OUTLINE_MAX_POINTS;
  return Array.from({ length: EDGE_OUTLINE_MAX_POINTS }, (_, i) => inset[Math.floor(i * step)]);
}

// ---------------------------------------------------------------------------
// Native payload
// ---------------------------------------------------------------------------

type Vec4 = [number, number, number, number];

const STROKE_CODE: Record<string, number> = {
  half: 11, quarter: 12, line: 13, comet: 14, dashPattern: 15, marchingAnts: 16,
  offset: 17, inner: 17, corners: 18, vertexDots: 19, wireframe: 20, zigzag: 21, wiggle: 22,
};
const FILL_CODE: Record<string, number> = {
  randomColor: 9, inside: 10, outside: 11, corner: 12, swipe: 13, globalSwipe: 14, stairs: 15,
  hypnotic: 16, stripes: 17, doubleStripes: 18, mosaic: 19, radialGlow: 20, origami: 21,
  halftone: 22, pattern: 23, hatch: 23, grid: 23, iris: 24, clockWipe: 25, scanLine: 26,
};
const ANIMATION_CODE: Record<string, number> = { flipX: 8, flipY: 9, elastic: 10, orbit: 11, bounce: 12, shake: 13 };
const PATTERN_CODE: Record<string, number> = { dots: 0, lines: 1, grid: 2, crosshatch: 3, chevron: 4, hexagon: 5 };
const PROGRESS_CODE: Record<string, number> = { loop: 0, pingpong: 1, beat: 2, manual: 3 };
const CAP_CODE: Record<string, number> = { butt: 0, round: 1, square: 2 };
const JOIN_CODE: Record<string, number> = { miter: 0, round: 1, bevel: 2 };
const TRIM_CODE: Record<string, number> = { none: 0, drawOn: 1, drawOff: 2, boomerang: 3 };
const BLEND_CODE: Record<string, number> = {
  normal: 0, add: 1, plus: 1, 'linear-dodge': 1, multiply: 2, screen: 3, overlay: 4, subtract: 5,
  difference: 6, lighten: 7, darken: 8, average: 9, hardlight: 10, 'hard-light': 10,
  softlight: 11, 'soft-light': 11, exclusion: 12, 'color-dodge': 13, 'color-burn': 14,
  hue: 15, saturation: 16, color: 17, luminosity: 18, divide: 19, negation: 20, phoenix: 21,
  'linear-light': 22, 'hard-mix': 23, 'vivid-light': 24, 'pin-light': 25,
};

const rad = (deg: unknown) => finite(deg, 0) * Math.PI / 180;
const rgbaOf = (value: unknown, fallback: Vec4): Vec4 =>
  Array.isArray(value) ? [0, 1, 2, 3].map((i) => finite(value[i], fallback[i])) as Vec4 : fallback;

/** Per-layer facts other layers contribute: group chases and group swipes. */
export interface EdgeEffectLayerContext {
  /** 0-1 position of the layer in its group for each chase ordering. */
  chase: { order: number; leftToRight: number; radial: number };
  /** Members in the layer's group (beat step chases count through them). */
  count: number;
  /** Union of the group's outlines, output px. */
  groupBounds: Vec4;
}

export interface EdgeEffectContext {
  width: number;
  height: number;
  layers: Map<string, EdgeEffectLayerContext>;
}

type ContextLayer = Pick<Layer, 'id' | 'edgeEffects' | 'layerShape' | 'corners' | 'warpMode' | 'meshGrid'> & { parentGroupId?: string | null };

function outlineFor(layer: ContextLayer, width: number, height: number): EdgeOutline | null {
  return buildEdgeOutline(layer, width, height, { cornerRadius: layer.edgeEffects?.cornerRadius });
}

/**
 * Group context for every layer carrying edge effects: layers sharing a
 * parent group (or, outside groups, all ungrouped edge layers) form one
 * chase and one swipe canvas.
 */
export function buildEdgeEffectContext(layers: readonly ContextLayer[], width: number, height: number): EdgeEffectContext {
  const groups = new Map<string, Array<{ layer: ContextLayer; index: number; outline: EdgeOutline }>>();
  layers.forEach((layer, index) => {
    if (!renderedEdgeEffects(layer.edgeEffects).length) return;
    const outline = outlineFor(layer, width, height);
    if (!outline) return;
    const key = layer.parentGroupId ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ layer, index, outline });
  });
  const context: EdgeEffectContext = { width, height, layers: new Map() };
  for (const members of groups.values()) {
    const bounds: Vec4 = [Infinity, Infinity, -Infinity, -Infinity];
    for (const m of members) {
      bounds[0] = Math.min(bounds[0], m.outline.bbox[0]);
      bounds[1] = Math.min(bounds[1], m.outline.bbox[1]);
      bounds[2] = Math.max(bounds[2], m.outline.bbox[2]);
      bounds[3] = Math.max(bounds[3], m.outline.bbox[3]);
    }
    const centre = { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 };
    const rank = (values: number[]) => {
      const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const out = new Array(values.length).fill(0);
      order.forEach(([, i], r) => { out[i] = members.length > 1 ? r / (members.length - 1) : 0; });
      return out;
    };
    const byOrder = rank(members.map((m) => m.index));
    const byX = rank(members.map((m) => m.outline.centroid.x));
    const byRadius = rank(members.map((m) => Math.hypot(m.outline.centroid.x - centre.x, m.outline.centroid.y - centre.y)));
    members.forEach((m, i) => context.layers.set(m.layer.id, {
      chase: { order: byOrder[i], leftToRight: byX[i], radial: byRadius[i] },
      count: members.length,
      groupBounds: bounds,
    }));
  }
  return context;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100003;
}

/** The 22 vec4s of one effect (heartbeat.wgsl documents the layout). */
export function packNativeEdgeEffect(
  effect: EdgeEffect,
  frame: { outline: EdgeOutline; layerCenter: Point2D; context?: EdgeEffectLayerContext; width: number; height: number },
): Vec4[] {
  const normalized = normalizeEdgeEffectStyle(effect, 'native');
  const s = resolveDrawingStyle(normalized, DEFAULT_DRAWING_STYLE);
  const stroke: any = normalized.stroke;
  const fill: any = normalized.fill;
  const animation: any = normalized.animation;

  const strokeType = STROKE_CODE[stroke.type] ?? s.strokeType;
  const fillType = FILL_CODE[fill.type] ?? s.fillType;
  const animationType = ANIMATION_CODE[animation.type] ?? s.animationType;

  let strokeB: Vec4 = [0, 0, 0, 0];
  let dash: Vec4 = [0, 0, 0, 0];
  switch (stroke.type) {
    case 'line': strokeB = [finite(stroke.length, 0.2), { normal: 0, boomerang: 1, yoyo: 2 }[stroke.mode as string] ?? 0, 0, 0]; break;
    case 'comet': strokeB = [finite(stroke.tailLength, 0.35), finite(stroke.headSize, 2), 0, 0]; break;
    case 'dashPattern': dash = [finite(stroke.dash1, 24), finite(stroke.gap1, 12), finite(stroke.dash2, 0), finite(stroke.gap2, 0)]; break;
    case 'marchingAnts': dash = [finite(stroke.dash1, 10), finite(stroke.gap1, 8), 0, 0]; strokeB = [stroke.beatLock === false ? 0 : 1, 0, 0, 0]; break;
    case 'offset': strokeB = [finite(stroke.count, 4), finite(stroke.spacing, 16), { inset: 0, outset: 1, both: 2 }[stroke.direction as string] ?? 1, 0]; break;
    case 'inner': strokeB = [finite(stroke.count, 4), finite(stroke.spacing, 14), 0, 0]; break;
    case 'corners': strokeB = [finite(stroke.length, 30), 0, 0, 0]; break;
    case 'vertexDots': strokeB = [finite(stroke.radius, 6), finite(stroke.burst, 1), 0, 0]; break;
    case 'wireframe': strokeB = [stroke.spokes === false ? 0 : 1, stroke.triangles === false ? 0 : 1, stroke.outline === false ? 0 : 1, 0]; break;
    case 'zigzag': strokeB = [finite(stroke.amplitude, 6), finite(stroke.wavelength, 24), 0, 0]; break;
    case 'wiggle': strokeB = [finite(stroke.amplitude, 5), finite(stroke.wavelength, 40), finite(stroke.seed, 1), 0]; break;
    default: break;
  }
  const defaults = edgeTypeDef('stroke', stroke.type)?.defaults ?? {};
  const cap = CAP_CODE[String(stroke.cap ?? defaults.cap ?? 'butt')] ?? 0;
  const join = JOIN_CODE[String(stroke.join ?? 'miter')] ?? 0;

  let fillColor = s.fillColor as Vec4;
  let fillColor2: Vec4 = s.fillType === 7 ? s.noiseColor2 as Vec4 : s.fillType === 8 ? s.gradColor2 as Vec4 : [0, 0, 0, 0];
  let fillA: Vec4 = [0, 0, 0, 0];
  let fillSpeed = s.fillSpeed;
  let gradType = s.gradType;
  switch (s.fillType) {
    case 2: fillA = [s.plasmaScale, s.plasmaComplexity, s.plasmaPalette, 0]; break;
    case 3: fillA = [s.liquidViscosity, s.liquidTurbulence, s.liquidMetallic, 0]; break;
    case 4: fillA = [s.fireIntensity, s.fireTurbulence, s.firePalette, 0]; break;
    case 5: fillA = [s.electricIntensity, s.electricArcCount, 0, 0]; break;
    case 6: fillA = [s.holoShift, s.holoScanlines, s.holoFlicker, 0]; break;
    case 7: fillA = [s.noiseScale, s.noiseTurbulence, 0, 0]; break;
    case 8: fillA = [s.gradAngle, 0, 0, 0]; if (fill.gradientType === 'diamond') gradType = 3; break;
    default: break;
  }
  if (fillType >= 9) {
    fillColor = rgbaOf(fill.color, [1, 1, 1, 1]);
    fillColor2 = rgbaOf(fill.color2 ?? fill.backgroundColor, [0, 0, 0, 0]);
    fillSpeed = finite(fill.speed, 0.5);
    switch (fill.type) {
      case 'randomColor':
        fillA = [finite(fill.saturation, 0.85), finite(fill.brightness, 1), fill.beatChange ? 1 : 0, 0];
        fillColor = [1, 1, 1, Math.max(0, Math.min(1, finite(fill.opacity, 1)))];
        break;
      case 'corner': fillA = [Math.round(finite(fill.corner, 0)), 0, 0, 0]; break;
      case 'swipe': case 'globalSwipe': fillA = [rad(fill.angle), finite(fill.softness, 0), 0, 0]; break;
      case 'stairs': fillA = [finite(fill.steps, 6), rad(fill.angle ?? 90), 0, 0]; break;
      case 'hypnotic': fillA = [finite(fill.band, 20), 0, 0, 0]; break;
      case 'stripes': case 'doubleStripes': fillA = [rad(fill.angle), finite(fill.stripeWidth, 16), 0, 0]; break;
      case 'mosaic': fillA = [finite(fill.cell, 24), 0, 0, 0]; break;
      case 'radialGlow': fillA = [finite(fill.radius, 0.8), finite(fill.intensity, 1), finite(fill.pulseSpeed, 0), 0]; break;
      case 'origami': fillA = [finite(fill.depth, 0.7), 0, 0, 0]; break;
      case 'halftone': fillA = [finite(fill.cell, 14), rad(fill.angle), fill.source === 'audio' ? 1 : 0, 0]; break;
      case 'pattern': case 'hatch': case 'grid': {
        const kind = fill.type === 'hatch' ? 1 : fill.type === 'grid' ? 2 : PATTERN_CODE[String(fill.pattern)] ?? 5;
        const scale = fill.type === 'pattern' ? finite(fill.scale, 24) : finite(fill.spacing, 12);
        fillA = [kind, scale, rad(fill.angle), finite(fill.lineWidth, 2)];
        fillSpeed = rad(fill.rotateSpeed ?? 0);
        break;
      }
      case 'scanLine': fillA = [finite(fill.lineWidth, 4), rad(fill.angle ?? 90), 0, 0]; break;
      default: break;
    }
  }
  let animA: Vec4 = [0, 0, 0, 0];
  switch (s.animationType) {
    case 1: animA = [s.concentricDirection, 0, 0, 0]; break;
    case 3: animA = [s.breatheMin, s.breatheMax, 0, 0]; break;
    case 4: animA = [s.rotateSpeed * (s.rotateDir === 1 ? -1 : 1), 0, 0, 0]; break;
    case 5: animA = [s.rippleDecay, 0, 0, 0]; break;
    case 6: animA = [s.waveAmplitude, s.waveFrequency, 0, 0]; break;
    case 7: animA = [s.glitchIntensity, s.glitchBlockSize, 0, 0]; break;
    default: break;
  }
  let animSpeed = s.animSpeed;
  switch (animation.type) {
    case 'flipX': case 'flipY': animA = [finite(animation.perspective, 0.6), 0, 0, 0]; animSpeed = finite(animation.speed, 0.25); break;
    case 'elastic': animA = [finite(animation.amount, 0.3), finite(animation.bounciness, 3), 0, 0]; animSpeed = finite(animation.speed, 0.5); break;
    case 'orbit': animA = [finite(animation.radius, 20), 0, 0, 0]; animSpeed = finite(animation.speed, 0.3) * (animation.direction === 'ccw' ? -1 : 1); break;
    case 'bounce': animA = [finite(animation.height, 30), 0, 0, 0]; animSpeed = finite(animation.speed, 1); break;
    case 'shake': animA = [finite(animation.intensity, 6), 0, 0, 0]; animSpeed = finite(animation.speed, 1); break;
    default: break;
  }

  // Centre: the shape's own centroid unless the effect sets one (layer UV).
  let center = frame.outline.centroid;
  const customCenter = (effect as any).customCenter === true;
  if (customCenter) {
    center = frame.layerCenter;
  }
  const chaseMode = String((effect as any).chaseMode ?? 'none');
  const chaseRank = chaseMode === 'order' ? frame.context?.chase.order
    : chaseMode === 'leftToRight' ? frame.context?.chase.leftToRight
      : chaseMode === 'radial' ? frame.context?.chase.radial : 0;
  const chaseDelay = (chaseRank ?? 0) * Math.max(0, finite((effect as any).chaseSpread, 0.5));
  const reactSlots = packEdgeReact(effect, frame.context);
  const trimStart = Math.max(0, Math.min(1, finite(stroke.trimStart, 0)));
  const trimEnd = Math.max(trimStart, Math.min(1, finite(stroke.trimEnd, 1)));

  return [
    [1, Math.max(0, Math.min(1, finite(effect.opacity, 1))), BLEND_CODE[String(effect.blendMode ?? 'normal')] ?? 0, strokeType],
    s.strokeColor as Vec4,
    [s.strokeWidth, s.glowSize, s.glowIntensity, s.pulseSpeed],
    [s.snakeLength, s.snakeSpeed, s.snakeCount, s.dashLength],
    [s.gapLength, s.electricArc, s.scannerBeamWidth, s.scannerTrail],
    [s.strobeRate, fillType, fillSpeed, gradType],
    fillColor,
    fillColor2,
    fillA,
    [animationType, s.animCount, s.animSpacing, animSpeed],
    animA,
    strokeB,
    reactSlots.chase,
    [cap, join, finite(stroke.miterLimit, 4), stroke.widthMode === 'surface' ? 1 : 0],
    [trimStart, trimEnd, finite(stroke.trimOffset, 0), TRIM_CODE[String(stroke.trimMode ?? 'none')] ?? 0],
    [finite(stroke.trimSpeed, 0.5), chaseDelay, 0, customCenter ? 1 : 0],
    [center.x, center.y, PROGRESS_CODE[String(fill.progressMode ?? 'loop')] ?? 0, finite(fill.progress, 1)],
    dash,
    frame.context?.groupBounds ?? [frame.outline.bbox[0], frame.outline.bbox[1], frame.outline.bbox[2], frame.outline.bbox[3]],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    reactSlots.react,
  ];
}

const REACT_MODE_CODE: Record<string, number> = { none: 0, pulse: 1, boost: 2, step: 3, strobe: 4 };
const REACT_SOURCE_CODE: Record<string, number> = { beat: 0, kick: 1, snare: 2, bass: 3, level: 4, treble: 5 };

/** Slots 12 (chase index, chase count, chase beats, hue per beat) and 21
 *  (mode, source, amount, decay) of a packed effect: its beat reaction. */
export function packEdgeReact(effect: EdgeEffect, context?: EdgeEffectLayerContext): { chase: Vec4; react: Vec4 } {
  const react = effect.react;
  const mode = REACT_MODE_CODE[String(react?.mode ?? 'none')] ?? 0;
  if (!react || mode === 0) return { chase: [0, 0, 0, 0], react: [0, 0, 0, 0] };
  const count = Math.max(1, context?.count ?? 1);
  const chaseMode = String(effect.chaseMode ?? 'none');
  // Beat chases follow the effect's group chase order; without one they
  // still count through the group in layer order.
  const rank = chaseMode === 'leftToRight' ? context?.chase.leftToRight
    : chaseMode === 'radial' ? context?.chase.radial : context?.chase.order;
  const index = Math.round((rank ?? 0) * (count - 1));
  return {
    chase: [index, count, Math.max(0, finite(react.chaseBeats, 0)), finite(react.hueStep, 0)],
    react: [mode, REACT_SOURCE_CODE[String(react.source)] ?? 0, Math.max(0, Math.min(1, finite(react.amount, 1))), Math.max(0.05, finite(react.decay, 1))],
  };
}

/**
 * Output-px distance beyond the centerline bbox (and discs around the
 * centre) outside which an effect is exactly transparent. Generous: a pixel
 * inside is simply evaluated.
 */
function effectReach(packed: Vec4[], outline: EdgeOutline, center: Point2D, width: number): { reach: number; disc: number } {
  const [head, , sw, , s4, , , , , an, ap, sb] = packed;
  const strokeType = head[3];
  const w = Math.abs(sw[0]);
  let reach = Math.max(Math.abs(sw[1]), w * 3.6, w * Math.abs(sb[1]) * (strokeType === 14 ? 1 : 0)) + 8 + Math.abs(s4[1]) * 0.012 * width;
  let radius = 0;
  for (const p of outline.points) radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y));
  let disc = 0;
  if (strokeType === 17) reach += Math.abs(sb[0]) * Math.abs(sb[1]) + Math.abs(sb[1]) + w;
  if (strokeType === 19) reach += Math.abs(sb[0]) * (1 + 3 * Math.abs(sb[1])) + w;
  if (strokeType === 21 || strokeType === 22) reach += Math.abs(sb[0]) * 1.5;
  switch (an[0]) {
    case 1: { const grow = Math.max(0, Math.floor(an[1])) * Math.abs(an[2]); reach += radius * grow + (w * 2 + 2) * (1 + grow); break; }
    case 2: disc = 0.4 * width; break;
    case 3: reach += radius * Math.max(0, Math.abs(ap[1]) - 1, Math.abs(ap[0]) - 1); break;
    case 4: disc = radius + reach; break;
    case 5: disc = Math.max(3, an[1]) * Math.abs(an[2]) * width + w * 2 + 2; break;
    case 6: reach += Math.abs(ap[0]) * 0.02 * width; break;
    case 7: reach += Math.abs(ap[0]) * 0.025 * width; break;
    // Flip perspective magnifies the near edge at most 2.5 / 1.5 times.
    case 8: case 9: disc = radius * 1.7 + reach; break;
    case 10: reach += radius * Math.abs(ap[0]) * 1.5; break;
    case 11: case 12: case 13: reach += Math.abs(ap[0]) * 1.2; break;
    default: break;
  }
  return { reach, disc };
}

/**
 * Distance from the centerline beyond which an effect draws nothing, for
 * effects whose shape stays put, and whether it draws deep inside the shape.
 * Effects that move or reshape the outline, or draw around the centre,
 * report an unbounded reach and rely on their rectangle.
 */
function effectDistanceCull(packed: Vec4[], reach: number): Vec4 {
  const strokeType = packed[0][3];
  const fillType = packed[5][1];
  const animType = packed[9][0];
  const unbounded = animType !== 0 && animType !== 1;
  const concentricInward = animType === 1 && packed[10][0] !== 0;
  const interior = fillType !== 0 || concentricInward || strokeType === 20
    || (strokeType === 17 && packed[11][2] !== 1);
  return [unbounded ? 1e6 : reach, interior ? 1 : 0, reach, 0];
}

export interface NativeEdgeEffectPayload {
  effects: Vec4[][];
  /** Centerline points (x px, y px, arc length px, surface scale). */
  outline: Vec4[];
  /** Corners (x px, y px, arc length px, point index). */
  corners: Vec4[];
  diagonals: Array<[number, number]>;
  /** (centroid x px, centroid y px, perimeter px, inradius px) */
  geometry: Vec4;
  seed: number;
  /** Output UV rectangle the stack can touch. */
  bounds: Vec4;
  truncated: boolean;
  segmentsNeeded: number;
}

/** Everything the native core needs to draw a layer's edge effects, or null. */
export function nativeEdgeEffectPayload(
  layer: ContextLayer,
  width: number,
  height: number,
  context?: EdgeEffectContext,
): NativeEdgeEffectPayload | null {
  const effects = renderedEdgeEffects(layer.edgeEffects);
  if (!effects.length) return null;
  const outline = outlineFor(layer, width, height);
  if (!outline) return null;
  const toOutput = layerUvToOutput(layer, width, height);
  const layerContext = context?.layers.get(layer.id);
  const packed = effects.map((effect) => {
    const cx = finite((effect as any).centerX, 0.5);
    const cy = finite((effect as any).centerY, 0.5);
    const layerCenter = toOutput ? toOutput({ x: cx, y: cy }) : outline.centroid;
    return packNativeEdgeEffect(effect, { outline, layerCenter, context: layerContext, width, height });
  });
  const clampUv = (v: number) => Math.max(-0.01, Math.min(1.01, v));
  let minX = outline.bbox[0], minY = outline.bbox[1], maxX = outline.bbox[2], maxY = outline.bbox[3];
  for (const fx of packed) {
    const center = { x: fx[16][0], y: fx[16][1] };
    const { reach, disc } = effectReach(fx, outline, center, width);
    const e0 = Math.min(outline.bbox[0] - reach, center.x - disc);
    const e1 = Math.min(outline.bbox[1] - reach, center.y - disc);
    const e2 = Math.max(outline.bbox[2] + reach, center.x + disc);
    const e3 = Math.max(outline.bbox[3] + reach, center.y + disc);
    minX = Math.min(minX, e0); minY = Math.min(minY, e1);
    maxX = Math.max(maxX, e2); maxY = Math.max(maxY, e3);
    // Per-effect culling: its own output rectangle (slot 19), and how far
    // from the centerline it can show (slot 20: reach px, has interior).
    fx[19] = [clampUv(e0 / width), clampUv(e1 / height), clampUv(e2 / width), clampUv(e3 / height)];
    fx[20] = effectDistanceCull(fx, reach);
  }
  return {
    effects: packed,
    outline: outline.points.map((p, i) => [p.x, p.y, outline.cumulative[i], outline.surfaceScale[i] ?? 1]),
    corners: outline.corners.map((i) => [outline.points[i].x, outline.points[i].y, outline.cumulative[i], i]),
    diagonals: outline.diagonals,
    geometry: [outline.centroid.x, outline.centroid.y, outline.length, outline.inradius],
    seed: hashString(layer.id),
    bounds: [clampUv(minX / width), clampUv(minY / height), clampUv(maxX / width), clampUv(maxY / height)],
    truncated: outline.truncated,
    segmentsNeeded: outline.segmentsNeeded,
  };
}

/** Warning for a layer whose outline needed more than 512 segments. */
export function edgeOutlineWarning(layer: ContextLayer, width = 1920, height = 1080): string | null {
  if (!renderedEdgeEffects(layer.edgeEffects).length) return null;
  const outline = outlineFor(layer, width, height);
  if (!outline?.truncated) return null;
  return `This outline needs ${outline.segmentsNeeded} segments to stay sharp; edge effects draw it with 512, so fine curves may look slightly faceted. Simplify the shape to keep it crisp.`;
}
