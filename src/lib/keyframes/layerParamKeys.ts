/**
 * The layer-relative override keys added for "keyframe everything": the
 * parts of a mapping layer that are not shader, effect or edge-effect
 * values. Each key has a reader (the layer's own value) and a writer (onto
 * a layer copy, never the store's object), so discovery, overrides and
 * recording all agree on what a key means.
 *
 *   layer:visible              shown / hidden (bool)
 *   layer:blend                blend mode, an index into BLEND_MODE_ORDER (stepped)
 *   transform:x | y            move the piece (output UV, y up), 0 = where it is
 *   transform:scale            uniform scale about the piece's centre, 1 = as is
 *   transform:scaleX | scaleY  scale per axis
 *   transform:rotation         degrees about the centre (counter-clockwise)
 *
 * A mapping piece is drawn by its corner pins (or mesh), not by the layer's
 * old position/scale/rotation fields, so the transform keys are relative:
 * they move, scale and turn the piece's corners and mesh points together,
 * after any corner or mesh key. Rotation is measured on the output (it uses
 * the output's aspect, setTransformAspect) so a piece does not shear.
 *   corner:<tl|tr|bl|br>:<x|y> a corner pin
 *   mesh:<row>:<col>:<x|y>     a mesh warp point
 *   sketch:<param>             a p5 / three.js sketch control
 *   video:rate                 video playback speed
 *   gpu:<param>                a GPU layer shader control
 *   look:<field>               the layer's edge Look as a whole (see LOOK_FIELDS)
 */
import { BLEND_MODE_ORDER, type BlendMode, type Layer } from '../types';

export type ParamKind = 'continuous' | 'stepped' | 'bool' | 'colour';

export const CORNER_KEYS = { tl: 'topLeft', tr: 'topRight', bl: 'bottomLeft', br: 'bottomRight' } as const;
type CornerShort = keyof typeof CORNER_KEYS;

/** Fields of the whole-Look keys. Each applies to every effect of the stack. */
export const LOOK_FIELDS = ['enabled', 'intensity', 'react', 'hue', 'chase', 'corner'] as const;
export type LookField = (typeof LOOK_FIELDS)[number];

/** Meshes larger than this are left out of discovery (a 16×16 mesh would be 512 lanes). */
export const MESH_DISCOVERY_MAX_POINTS = 100;

let outputAspect = 16 / 9;
/** The output's width / height, for rotating pieces without shearing them. */
export function setTransformAspect(aspect: number): void {
  if (Number.isFinite(aspect) && aspect > 0) outputAspect = Math.max(0.05, Math.min(20, aspect));
}

export function getTransformAspect(): number {
  return outputAspect;
}

/** Per-call state of applyLayerExtra: objects already copied, and the
 *  transform gathered so it is applied once, after corner and mesh keys. */
export interface ExtraApplyState {
  copied: Set<string>;
  transform: { x: number; y: number; sx: number; sy: number; rot: number } | null;
}

export function extraApplyState(): ExtraApplyState {
  return { copied: new Set(), transform: null };
}

export function blendIndex(mode: BlendMode | string | undefined): number {
  const index = BLEND_MODE_ORDER.indexOf((mode ?? 'normal') as BlendMode);
  return index < 0 ? 0 : index;
}

export function blendAt(value: number | boolean): BlendMode {
  const n = typeof value === 'boolean' ? (value ? 1 : 0) : Math.round(Number(value) || 0);
  return BLEND_MODE_ORDER[Math.max(0, Math.min(BLEND_MODE_ORDER.length - 1, n))];
}

const truthy = (value: number | boolean) => (typeof value === 'boolean' ? value : Number(value) >= 0.5);
const num = (value: number | boolean) => (typeof value === 'boolean' ? (value ? 1 : 0) : Number(value));

/** True for keys this module owns. */
export function isLayerExtraKey(key: string): boolean {
  return key === 'layer:visible' || key === 'layer:blend' || key === 'video:rate'
    || key.startsWith('transform:') || key.startsWith('corner:') || key.startsWith('mesh:')
    || key.startsWith('sketch:') || key.startsWith('gpu:') || key.startsWith('look:');
}

/** The layer's own value for `key`, or undefined when the layer has no such control. */
export function readLayerExtra(layer: Layer, key: string): number | boolean | undefined {
  const l = layer as any;
  if (key === 'layer:visible') return l.visible !== false;
  if (key === 'layer:blend') return blendIndex(l.blendMode);
  if (key === 'video:rate') return l.source?.type === 'video' ? Number(l.source.playbackRate ?? 1) : undefined;
  if (key.startsWith('transform:')) {
    // Relative: a piece at rest is not moved, scaled or turned.
    const f = key.slice(10);
    if (!l.corners) return undefined;
    if (f === 'x' || f === 'y' || f === 'rotation') return 0;
    if (f === 'scale' || f === 'scaleX' || f === 'scaleY') return 1;
    return undefined;
  }
  if (key.startsWith('corner:')) {
    const [, c, axis] = key.split(':');
    const corner = l.corners?.[CORNER_KEYS[c as CornerShort]];
    return corner && (axis === 'x' || axis === 'y') ? Number(corner[axis]) : undefined;
  }
  if (key.startsWith('mesh:')) {
    const [, r, c, axis] = key.split(':');
    const p = l.meshGrid?.points?.[Number(r)]?.[Number(c)];
    return p && (axis === 'x' || axis === 'y') ? Number(p[axis]) : undefined;
  }
  if (key.startsWith('sketch:')) {
    const js = l.source?.jsAnimation;
    if (!js) return undefined;
    const name = key.slice(7);
    const def = js.params?.find((p: any) => p.name === name);
    const value = js.paramValues?.[name] ?? def?.default;
    return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
  }
  if (key.startsWith('gpu:')) {
    const value = l.gpuLayerContent?.params?.[key.slice(4)];
    return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
  }
  if (key.startsWith('look:')) {
    const edge = l.edgeEffects;
    if (!edge?.effects?.length) return undefined;
    const first = edge.effects[0];
    switch (key.slice(5) as LookField) {
      case 'enabled': return edge.enabled !== false;
      case 'intensity': return 1;
      case 'react': return Number(first.react?.amount ?? 0);
      case 'hue': return Number(first.react?.hueStep ?? 0);
      case 'chase': return Number(first.chaseSpread ?? 0.5);
      case 'corner': return Number(edge.cornerRadius ?? 0);
    }
  }
  return undefined;
}

/**
 * Write one of this module's keys onto `next`, a shallow copy of a layer.
 * Nested objects are copied on the way (once per object per call, tracked in
 * `copied`), never mutated. Returns false for a key it does not own.
 */
export function applyLayerExtra(next: any, key: string, value: number | boolean, state: ExtraApplyState): boolean {
  const copied = state.copied;
  const once = (name: string, make: () => void) => {
    if (copied.has(name)) return;
    copied.add(name);
    make();
  };
  if (key === 'layer:visible') { next.visible = truthy(value); return true; }
  if (key === 'layer:blend') { next.blendMode = blendAt(value); return true; }
  if (key === 'video:rate') {
    if (next.source?.type === 'video') {
      once('source', () => { next.source = { ...next.source }; });
      next.source.playbackRate = Math.max(0, num(value));
    }
    return true;
  }
  if (key.startsWith('transform:')) {
    const f = key.slice(10);
    const v = num(value);
    const t = (state.transform ??= { x: 0, y: 0, sx: 1, sy: 1, rot: 0 });
    if (f === 'x') t.x = v;
    else if (f === 'y') t.y = v;
    else if (f === 'scale') { t.sx = v; t.sy = v; }
    else if (f === 'scaleX') t.sx = v;
    else if (f === 'scaleY') t.sy = v;
    else if (f === 'rotation') t.rot = v;
    return true;
  }
  if (key.startsWith('corner:')) {
    const [, c, axis] = key.split(':');
    const name = CORNER_KEYS[c as CornerShort];
    if (!name || !next.corners || (axis !== 'x' && axis !== 'y')) return true;
    once('corners', () => { next.corners = { ...next.corners }; });
    once(`corner:${name}`, () => { next.corners[name] = { ...next.corners[name] }; });
    next.corners[name][axis] = num(value);
    return true;
  }
  if (key.startsWith('mesh:')) {
    const [, rs, cs, axis] = key.split(':');
    const r = Number(rs);
    const c = Number(cs);
    const points = next.meshGrid?.points;
    if (!points?.[r]?.[c] || (axis !== 'x' && axis !== 'y')) return true;
    once('mesh', () => { next.meshGrid = { ...next.meshGrid, points: [...next.meshGrid.points] }; });
    once(`mesh:${r}`, () => { next.meshGrid.points[r] = [...next.meshGrid.points[r]]; });
    once(`mesh:${r}:${c}`, () => { next.meshGrid.points[r][c] = { ...next.meshGrid.points[r][c] }; });
    next.meshGrid.points[r][c][axis] = num(value);
    return true;
  }
  if (key.startsWith('sketch:')) {
    const js = next.source?.jsAnimation;
    if (!js) return true;
    once('sketch', () => {
      next.source = { ...next.source, jsAnimation: { ...js, paramValues: { ...(js.paramValues ?? {}) } } };
    });
    const name = key.slice(7);
    const def = next.source.jsAnimation.params?.find((p: any) => p.name === name);
    next.source.jsAnimation.paramValues[name] = def?.type === 'boolean' ? truthy(value) : value;
    return true;
  }
  if (key.startsWith('gpu:')) {
    if (!next.gpuLayerContent) return true;
    once('gpu', () => {
      next.gpuLayerContent = { ...next.gpuLayerContent, params: { ...(next.gpuLayerContent.params ?? {}) } };
    });
    next.gpuLayerContent.params[key.slice(4)] = value;
    return true;
  }
  if (key.startsWith('look:')) {
    const edge = next.edgeEffects;
    if (!edge?.effects?.length) return true;
    once('look', () => {
      next.edgeEffects = { ...edge, effects: edge.effects.map((e: any) => ({ ...e, ...(e.react ? { react: { ...e.react } } : {}) })) };
    });
    const field = key.slice(5) as LookField;
    const v = num(value);
    const target = next.edgeEffects;
    switch (field) {
      case 'enabled': target.enabled = truthy(value); break;
      case 'intensity':
        // Scales every effect's own opacity, so the Look's balance is kept.
        if (!copied.has('look:intensity:base')) {
          copied.add('look:intensity:base');
          target.effects.forEach((e: any, i: number) => { e.opacity = Number(edge.effects[i].opacity ?? 1) * Math.max(0, v); });
        }
        break;
      case 'react': target.effects.forEach((e: any) => { if (e.react) e.react.amount = Math.max(0, Math.min(1, v)); }); break;
      case 'hue': target.effects.forEach((e: any) => { if (e.react) e.react.hueStep = v; }); break;
      case 'chase': target.effects.forEach((e: any) => { if (e.chaseMode && e.chaseMode !== 'none') e.chaseSpread = Math.max(0, v); }); break;
      case 'corner': target.cornerRadius = Math.max(0, v); break;
    }
    return true;
  }
  return false;
}

/**
 * After all keys: move, scale and turn the piece's corners and mesh points
 * about the corners' centre (copies, as the other writers).
 */
export function finishLayerExtras(next: any, state: ExtraApplyState): void {
  const t = state.transform;
  if (!t || !next.corners) return;
  // A list that has been through here can come back (the native sync
  // re-flushes what it last sent): start from the untransformed geometry
  // kept on the copy, or the move would add up frame after frame.
  const base = next._transformBase ?? { corners: next.corners, meshGrid: next.meshGrid };
  next._transformBase = base;
  next.corners = base.corners;
  next.meshGrid = base.meshGrid;
  if (t.x === 0 && t.y === 0 && t.sx === 1 && t.sy === 1 && t.rot === 0) return;
  const c = next.corners;
  const cx = (c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4;
  const cy = (c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4;
  const a = (t.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const k = outputAspect;
  const move = (p: { x: number; y: number }) => {
    // Scale in UV, rotate in output pixels (x × aspect), then shift.
    const dx = (p.x - cx) * t.sx * k;
    const dy = (p.y - cy) * t.sy;
    return { ...p, x: cx + (dx * cos - dy * sin) / k + t.x, y: cy + (dx * sin + dy * cos) + t.y };
  };
  next.corners = {
    topLeft: move(c.topLeft),
    topRight: move(c.topRight),
    bottomLeft: move(c.bottomLeft),
    bottomRight: move(c.bottomRight),
  };
  if (next.meshGrid?.points) {
    next.meshGrid = { ...next.meshGrid, points: next.meshGrid.points.map((row: any[]) => row.map(move)) };
  }
}
