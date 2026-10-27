import { describe, expect, it } from 'vitest';
import type { BezierPoint, Layer, MeshWarpGrid, Point2D, WarpCorners } from '../types';
import {
  arrowKeysFree,
  classifyKeyTarget,
  layersMovedTogether,
  nudgeStepPixels,
  planMappingArrowKey,
  projectPixelOffset,
  resolveMappingPoint,
  type MappingKeyPress,
  type MappingKeyState,
  type MappingPointRef,
} from './mappingNudge';
import { layerUvToCanvas, quadPoint } from './layerQuad';

type TestLayer = MappingKeyState['layers'][number];

const W = 1920;
const H = 1080;

function rect(x0: number, y0: number, x1: number, y1: number): WarpCorners {
  return {
    topLeft: { x: x0, y: y1 },
    topRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y0 },
    bottomRight: { x: x1, y: y0 },
  };
}

/** A quad half the canvas size, turned 30° about its centre. */
function turnedHalfQuad(): WarpCorners {
  const a = Math.PI / 6;
  const turn = (x: number, y: number): Point2D => ({
    x: 0.5 + (x * Math.cos(a) - y * Math.sin(a)) * 0.5,
    y: 0.5 + (x * Math.sin(a) + y * Math.cos(a)) * 0.5,
  });
  return { topLeft: turn(-0.5, 0.5), topRight: turn(0.5, 0.5), bottomLeft: turn(-0.5, -0.5), bottomRight: turn(0.5, -0.5) };
}

function meshGrid(rows: number, cols: number, bend = 0): MeshWarpGrid {
  const points = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({
    x: c / (cols - 1) + (r === 1 && c === 1 ? bend : 0),
    y: 1 - r / (rows - 1) + (r === 1 && c === 1 ? bend / 2 : 0),
  })));
  return { rows, cols, points };
}

function layer(id: string, extra: Partial<TestLayer> = {}): TestLayer {
  return { id, type: 'media', corners: rect(0, 0, 1, 1), warpMode: 'corners', meshGrid: null, ...extra } as TestLayer;
}

const press = (key: string, extra: Partial<MappingKeyPress> = {}): MappingKeyPress => ({
  key, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, target: 'other', focus: 'other', ...extra,
});

function state(selected: TestLayer, selection: MappingPointRef | null, extra: Partial<MappingKeyState> = {}): MappingKeyState {
  return {
    layer: selected,
    layers: [selected],
    selectedIds: [],
    selection,
    ctx: { shapeWarpEditing: false, maskEditing: false },
    granularity: '1px',
    projectWidth: W,
    projectHeight: H,
    ...extra,
  };
}

function patchOf(plan: ReturnType<typeof planMappingArrowKey>, index = 0): Partial<Layer> {
  if (!plan || plan.type !== 'nudge') throw new Error(`expected a nudge, got ${JSON.stringify(plan)}`);
  return plan.patches[index].patch;
}

describe('mapping nudge: step size', () => {
  it('follows the drag granularity, Shift ten times, Alt a tenth', () => {
    const cases: Array<[Parameters<typeof nudgeStepPixels>[0], number]> = [['sub', 0.5], ['1px', 1], ['5px', 5], ['10px', 10], ['free', 1], [undefined, 1]];
    for (const [granularity, px] of cases) {
      expect(nudgeStepPixels(granularity, false, false)).toBeCloseTo(px, 12);
      expect(nudgeStepPixels(granularity, true, false)).toBeCloseTo(px * 10, 12);
      expect(nudgeStepPixels(granularity, false, true)).toBeCloseTo(px / 10, 12);
    }
  });

  it('turns screen-up into +y for layers and -y for screens', () => {
    expect(projectPixelOffset(0, -1, W, H, true)).toEqual({ x: 0, y: 1 / H });
    expect(projectPixelOffset(0, -1, W, H, false)).toEqual({ x: 0, y: -1 / H });
    expect(projectPixelOffset(1, 0, W, H, true)).toEqual({ x: 1 / W, y: 0 });
  });
});

describe('mapping nudge: layer corners and edges', () => {
  const selected = layer('a', { corners: rect(0.25, 0.25, 0.75, 0.75) });

  it('moves the selected corner one project pixel per press', () => {
    const ref: MappingPointRef = { kind: 'corner', layerId: 'a', corner: 'topLeft' };
    const right = patchOf(planMappingArrowKey(press('ArrowRight'), state(selected, ref)));
    expect(right.corners!.topLeft.x).toBeCloseTo(0.25 + 1 / W, 15);
    expect(right.corners!.topRight).toEqual(selected.corners.topRight);
    const up = patchOf(planMappingArrowKey(press('ArrowUp'), state(selected, ref)));
    expect(up.corners!.topLeft.y).toBeCloseTo(0.75 + 1 / H, 15);
    const fine = patchOf(planMappingArrowKey(press('ArrowLeft', { altKey: true }), state(selected, ref)));
    expect(fine.corners!.topLeft.x).toBeCloseTo(0.25 - 0.1 / W, 15);
    const big = patchOf(planMappingArrowKey(press('ArrowDown', { shiftKey: true }), state(selected, ref)));
    expect(big.corners!.topLeft.y).toBeCloseTo(0.75 - 10 / H, 15);
  });

  it('moves both corners of a selected edge', () => {
    const ref: MappingPointRef = { kind: 'edge', layerId: 'a', edge: 'right' };
    const patch = patchOf(planMappingArrowKey(press('ArrowRight'), state(selected, ref)));
    expect(patch.corners!.topRight.x).toBeCloseTo(0.75 + 1 / W, 15);
    expect(patch.corners!.bottomRight.x).toBeCloseTo(0.75 + 1 / W, 15);
    expect(patch.corners!.topLeft).toEqual(selected.corners.topLeft);
  });

  it('moves an edge of a mesh layer (its edge handles stay), not a hidden corner', () => {
    const meshed = layer('a', { corners: rect(0.25, 0.25, 0.75, 0.75), warpMode: 'mesh', meshGrid: meshGrid(3, 3) });
    const patch = patchOf(planMappingArrowKey(press('ArrowLeft'), state(meshed, { kind: 'edge', layerId: 'a', edge: 'left' })));
    expect(patch.corners!.topLeft.x).toBeCloseTo(0.25 - 1 / W, 15);
    expect(planMappingArrowKey(press('ArrowLeft'), state(meshed, { kind: 'corner', layerId: 'a', corner: 'topLeft' })))
      .toEqual({ type: 'clear-selection' });
  });

  it('moves the selected layers, groups with their children, when nothing is selected', () => {
    const layers = [
      layer('g', { type: 'group' }),
      layer('child', { parentGroupId: 'g' }),
      layer('locked', { locked: true }),
      layer('other'),
    ];
    expect(layersMovedTogether(layers, 'g', ['g', 'locked'])).toEqual(['g', 'child']);
    const plan = planMappingArrowKey(press('ArrowRight'), state(layers[0], null, { layers, selectedIds: ['g', 'locked'] }));
    expect(plan?.type).toBe('nudge');
    if (plan?.type !== 'nudge') return;
    expect(plan.patches.map((p) => p.layerId)).toEqual(['g', 'child']);
    expect(plan.patches[1].patch.corners!.topLeft.x).toBeCloseTo(1 / W, 15);
  });
});

describe('mapping nudge: mesh points', () => {
  const corners = turnedHalfQuad();
  const grid = meshGrid(3, 3, 0.05);
  const selected = layer('m', { corners, warpMode: 'mesh', meshGrid: grid });
  const ref: MappingPointRef = { kind: 'mesh', layerId: 'm', row: 1, col: 1 };
  const drawn = (p: Point2D) => quadPoint(corners, p.x, p.y);

  it('moves a point on a half-size turned quad exactly one project pixel across the screen', () => {
    const before = drawn(grid.points[1][1]);
    const right = drawn(patchOf(planMappingArrowKey(press('ArrowRight'), state(selected, ref))).meshGrid!.points[1][1]);
    expect(right.x - before.x).toBeCloseTo(1 / W, 12);
    expect(right.y - before.y).toBeCloseTo(0, 12);
    const up = drawn(patchOf(planMappingArrowKey(press('ArrowUp'), state(selected, ref))).meshGrid!.points[1][1]);
    expect(up.x - before.x).toBeCloseTo(0, 12);
    expect(up.y - before.y).toBeCloseTo(1 / H, 12);
  });

  it('moves a selected tangent handle on a Bezier mesh, Alt unlinks it instead of a finer step', () => {
    const bezier = layer('m', { corners, warpMode: 'mesh', meshGrid: { ...grid, bezier: true } });
    const tangentRef: MappingPointRef = { ...ref, tangent: 'right' };
    const linked = patchOf(planMappingArrowKey(press('ArrowUp'), state(bezier, tangentRef))).meshGrid!;
    expect(linked.tangents?.[1][1]?.right).toBeDefined();
    expect(linked.tangents?.[1][1]?.left).toBeUndefined();
    const unlinked = patchOf(planMappingArrowKey(press('ArrowUp', { altKey: true }), state(bezier, tangentRef))).meshGrid!;
    expect(unlinked.tangents?.[1][1]?.left).toBeDefined();
    // Same distance with or without Alt: Alt is not the fine step here.
    expect(unlinked.tangents![1][1]!.right!.y).toBeCloseTo(linked.tangents![1][1]!.right!.y, 12);
  });

  it('a point that no longer exists lets go instead of throwing or moving the layer', () => {
    const stale: MappingPointRef = { kind: 'mesh', layerId: 'm', row: 7, col: 7 };
    expect(() => planMappingArrowKey(press('ArrowRight'), state(selected, stale))).not.toThrow();
    expect(planMappingArrowKey(press('ArrowRight'), state(selected, stale))).toEqual({ type: 'clear-selection' });
    // A corner of a layer now in mesh mode, and another layer's point.
    expect(planMappingArrowKey(press('ArrowLeft'), state(selected, { kind: 'corner', layerId: 'm', corner: 'topLeft' })))
      .toEqual({ type: 'clear-selection' });
    expect(resolveMappingPoint({ kind: 'mesh', layerId: 'other', row: 0, col: 0 }, selected, state(selected, null).ctx)).toBeNull();
    // A tangent on a mesh with Bezier off is just the point.
    expect(resolveMappingPoint({ ...ref, tangent: 'up' }, selected, state(selected, null).ctx)).toEqual(ref);
  });
});

describe('mapping nudge: custom shape vertices', () => {
  const corners: WarpCorners = {
    topLeft: { x: 0.2, y: 0.85 }, topRight: { x: 0.8, y: 0.9 },
    bottomLeft: { x: 0.1, y: 0.15 }, bottomRight: { x: 0.85, y: 0.1 },
  };
  const vertex: BezierPoint = { x: 0.4, y: 0.6, cpIn: { x: 0.35, y: 0.55 }, cpOut: { x: 0.45, y: 0.65 } };
  const shaped = layer('s', {
    corners,
    warpMode: 'mesh',
    meshGrid: meshGrid(3, 3, 0.04),
    layerShape: {
      type: 'custom', enabled: true,
      params: { customClosed: true, customPoints: [{ x: 0.1, y: 0.1 }, vertex, { x: 0.9, y: 0.2 }] },
    } as TestLayer['layerShape'],
  });
  // The layer has a warped mesh, but a Custom Shape's outline is drawn
  // through the corners only: the mesh warps the content inside it.
  const drawn = (p: Point2D) => layerUvToCanvas(corners, null, p);
  const ref: MappingPointRef = { kind: 'shape-vertex', layerId: 's', index: 1 };

  it('moves the vertex one project pixel on the canvas, through the corners (not the mesh), with its handles', () => {
    const patch = patchOf(planMappingArrowKey(press('ArrowRight'), state(shaped, ref)));
    const moved = (patch.layerShape!.params.customPoints as BezierPoint[])[1];
    const before = drawn(vertex);
    const after = drawn(moved);
    expect(after.x - before.x).toBeCloseTo(1 / W, 10);
    expect(after.y - before.y).toBeCloseTo(0, 10);
    expect(moved.cpIn!.x - vertex.cpIn!.x).toBeCloseTo(moved.x - vertex.x, 12);
    expect(moved.cpOut!.y - vertex.cpOut!.y).toBeCloseTo(moved.y - vertex.y, 12);
  });

  it('moves a selected curve handle and mirrors its partner unless Alt is held', () => {
    const handleRef: MappingPointRef = { ...ref, handle: 'cpOut' };
    const mirrored = (patchOf(planMappingArrowKey(press('ArrowDown'), state(shaped, handleRef))).layerShape!.params.customPoints as BezierPoint[])[1];
    expect(mirrored.x).toBe(vertex.x);
    expect(mirrored.cpIn!.x).toBeCloseTo(2 * vertex.x - mirrored.cpOut!.x, 12);
    const alone = (patchOf(planMappingArrowKey(press('ArrowDown', { altKey: true }), state(shaped, handleRef))).layerShape!.params.customPoints as BezierPoint[])[1];
    expect(alone.cpIn).toEqual(vertex.cpIn);
    expect(drawn(alone.cpOut!).y - drawn(vertex.cpOut!).y).toBeCloseTo(-1 / H, 10);
  });

  it('only while the shape is closed', () => {
    const open = layer('s', { layerShape: { ...shaped.layerShape!, params: { ...shaped.layerShape!.params, customClosed: false } } });
    expect(resolveMappingPoint(ref, open, state(open, null).ctx)).toBeNull();
  });
});

describe('mapping nudge: shape warp and mask points', () => {
  it('moves a shape warp point only while shape warp editing is on', () => {
    const selected = layer('c', {
      corners: rect(0.2, 0.2, 0.6, 0.8),
      layerShape: { type: 'circle', enabled: true, params: {}, controlPoints: [{ x: 0.5, y: 0.5 }] } as TestLayer['layerShape'],
    });
    const ref: MappingPointRef = { kind: 'shape-control', layerId: 'c', index: 0 };
    expect(planMappingArrowKey(press('ArrowRight'), state(selected, ref))).toEqual({ type: 'clear-selection' });
    const editing = state(selected, ref, { ctx: { shapeWarpEditing: true, maskEditing: false } });
    const p = patchOf(planMappingArrowKey(press('ArrowRight'), editing)).layerShape!.controlPoints![0];
    const c = selected.corners;
    expect(quadPoint(c, p.x, p.y).x - quadPoint(c, 0.5, 0.5).x).toBeCloseTo(1 / W, 12);
  });

  it('moves a mask point with its handles, on the canvas', () => {
    const selected = layer('k', {
      mask: { enabled: true, inverted: false, feather: 0, shapes: [{ closed: true, points: [
        { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.8, cpIn: { x: 0.45, y: 0.8 }, cpOut: { x: 0.55, y: 0.8 } }, { x: 0.8, y: 0.2 },
      ] }] },
    });
    const ref: MappingPointRef = { kind: 'mask-point', layerId: 'k', shapeIndex: 0, index: 1 };
    const editing = state(selected, ref, { ctx: { shapeWarpEditing: false, maskEditing: true } });
    const p = patchOf(planMappingArrowKey(press('ArrowUp'), editing)).mask!.shapes[0].points[1];
    expect(p.y).toBeCloseTo(0.8 + 1 / H, 12);
    expect(p.cpIn!.y).toBeCloseTo(0.8 + 1 / H, 12);
    expect(planMappingArrowKey(press('ArrowUp'), state(selected, ref))).toEqual({ type: 'clear-selection' });
  });
});

describe('mapping nudge: which keys belong to the canvas', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, getAttribute: () => null, closest: () => null, ...extra });

  it('leaves arrows to typing fields, sliders, lists and dialogs', () => {
    expect(classifyKeyTarget(el('INPUT', { type: 'text' }))).toBe('text');
    expect(classifyKeyTarget(el('INPUT', { type: 'number' }))).toBe('text');
    expect(classifyKeyTarget(el('TEXTAREA'))).toBe('text');
    expect(classifyKeyTarget(el('DIV', { isContentEditable: true }))).toBe('text');
    expect(classifyKeyTarget(el('INPUT', { type: 'range' }))).toBe('adjust');
    expect(classifyKeyTarget(el('SELECT'))).toBe('adjust');
    expect(classifyKeyTarget(el('DIV', { getAttribute: (n: string) => (n === 'role' ? 'slider' : null) }))).toBe('adjust');
    expect(classifyKeyTarget(el('BUTTON', { closest: () => ({}) }))).toBe('adjust');
    expect(classifyKeyTarget(el('INPUT', { type: 'checkbox' }))).toBe('other');
    expect(classifyKeyTarget(el('BUTTON'))).toBe('other');
    expect(classifyKeyTarget(el('BODY'))).toBe('other');
    expect(classifyKeyTarget(null)).toBe('other');
  });

  it('ignores the arrows unless both the target and the focus are free, and with Cmd or Ctrl', () => {
    const selected = layer('a');
    const ref: MappingPointRef = { kind: 'corner', layerId: 'a', corner: 'topLeft' };
    expect(planMappingArrowKey(press('ArrowRight', { target: 'text' }), state(selected, ref))).toBeNull();
    expect(planMappingArrowKey(press('ArrowRight', { focus: 'adjust' }), state(selected, ref))).toBeNull();
    expect(planMappingArrowKey(press('ArrowRight', { metaKey: true }), state(selected, ref))).toBeNull();
    expect(planMappingArrowKey(press('ArrowRight', { ctrlKey: true }), state(selected, ref))).toBeNull();
    expect(planMappingArrowKey(press('a'), state(selected, ref))).toBeNull();
    expect(arrowKeysFree({ metaKey: false, ctrlKey: false, target: 'other', focus: 'other' })).toBe(true);
  });

  it('Escape lets go of a curve handle first, then the point', () => {
    const bezier = layer('m', { warpMode: 'mesh', meshGrid: { ...meshGrid(3, 3), bezier: true } });
    const tangent: MappingPointRef = { kind: 'mesh', layerId: 'm', row: 1, col: 1, tangent: 'left' };
    expect(planMappingArrowKey(press('Escape'), state(bezier, tangent)))
      .toEqual({ type: 'release-handle', selection: { kind: 'mesh', layerId: 'm', row: 1, col: 1 } });
    expect(planMappingArrowKey(press('Escape'), state(bezier, { kind: 'mesh', layerId: 'm', row: 1, col: 1 })))
      .toEqual({ type: 'clear-selection' });
    expect(planMappingArrowKey(press('Escape', { target: 'text' }), state(bezier, tangent))).toBeNull();
    expect(planMappingArrowKey(press('Escape'), state(bezier, null))).toBeNull();
  });
});
