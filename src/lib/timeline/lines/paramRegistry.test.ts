import { describe, expect, it } from 'vitest';
import { BLEND_MODE_ORDER, createLayer, createMeshGrid, type Layer, type WLEDController, type WLEDEffect } from '../../types';
import { applyParamOverrides } from '../../keyframes/applyParamOverrides';
import { createWLEDEffect } from '../../wled/effects';
import { layerParams, ledParams, readLayerParam, readParam, stageParams, type ParamEntry } from './paramRegistry';
import { applyLedControllerOverrides, applyLedEffectOverrides, applyStageOverrides, colorHex, readStageLedParam } from './stageLedParams';

function richLayer(): Layer {
  const layer = createLayer('L1', 'Facade');
  return {
    ...layer,
    blendMode: 'screen',
    position: { x: 0.1, y: -0.2 },
    scale: { x: 1, y: 1.5 },
    rotation: 10,
    warpMode: 'mesh',
    meshGrid: createMeshGrid(3, 3),
    source: {
      id: 'src', type: 'shader', src: 'x.fs', name: 'x',
      shaderInputs: [{ NAME: 'speed', TYPE: 'float', MIN: 0, MAX: 4, DEFAULT: 1 }, { NAME: 'count', TYPE: 'long', MIN: 0, MAX: 8, DEFAULT: 2 }] as any,
      shaderValues: { speed: 1, count: 2 },
      jsAnimation: {
        animationType: 'p5', htmlCode: '<html></html>',
        params: [{ name: 'size', type: 'number', default: 10, min: 0, max: 100 }, { name: 'trails', type: 'boolean', default: false }, { name: 'tint', type: 'color', default: '#fff' }],
        paramValues: { size: 20 },
      } as any,
    },
    effects: [{ id: 'fx1', type: 'blur', enabled: true, opacity: 1, params: { amount: 0.2 } } as any],
    edgeEffects: {
      enabled: true,
      cornerRadius: 4,
      effects: [{
        id: 'e1', enabled: true, opacity: 0.8, blendMode: 'normal',
        stroke: { type: 'solid', width: 2 } as any, fill: { type: 'none' } as any, animation: { type: 'none' } as any,
        chaseMode: 'order', chaseSpread: 0.5, react: { mode: 'pulse', source: 'beat', amount: 0.5, hueStep: 0 },
      }],
    },
  } as Layer;
}

function gpuLayer(): Layer {
  return { ...createLayer('G1', 'Planet', 'gpu'), gpuLayerContent: { shaderId: 'planet', params: {} } as any } as Layer;
}

/** A value different from the param's default, inside its range. */
function another(p: ParamEntry): number | boolean {
  if (p.kind === 'bool') return !p.default;
  const d = Number(p.default);
  const span = p.max - p.min;
  let v = d + span * 0.25 > p.max ? d - span * 0.25 : d + span * 0.25;
  if (p.kind === 'stepped' || p.kind === 'colour') v = Math.round(v / p.step) * p.step;
  if (v === d) v = d === p.max ? p.min : p.max;
  return v;
}

describe('parameter registry', () => {
  it('every discovered layer key applies to a copy and reads back, the layer untouched', () => {
    for (const layer of [richLayer(), gpuLayer()]) {
      const params = layerParams(layer);
      const before = JSON.stringify(layer);
      expect(params.length).toBeGreaterThan(10);
      for (const p of params) {
        expect(['continuous', 'stepped', 'bool', 'colour']).toContain(p.kind);
        expect(p.min).toBeLessThanOrEqual(p.max);
        const value = another(p);
        const next = { ...layer };
        applyParamOverrides(next, { [p.key]: value });
        const read = readLayerParam(next, p.key);
        if (p.key.startsWith('transform:')) {
          // Relative keys move the piece's corners; the layer reads at rest.
          expect(next.corners, p.key).not.toEqual(layer.corners);
          continue;
        }
        if (p.key === 'look:intensity') {
          // Intensity scales the effects' own opacity.
          expect((next as any).edgeEffects.effects[0].opacity).toBeCloseTo(0.8 * Number(value));
        } else if (p.kind === 'bool') {
          expect(read, p.key).toBe(value);
        } else {
          expect(Number(read), p.key).toBeCloseTo(Number(value), 6);
        }
      }
      expect(JSON.stringify(layer)).toBe(before);
    }
  });

  it('covers transform, corners, mesh, visibility, blend, sketch, video, gpu and the Look', () => {
    const keys = layerParams(richLayer()).map((p) => p.key);
    for (const key of ['layer:opacity', 'layer:visible', 'layer:blend', 'transform:x', 'transform:y', 'transform:scale', 'transform:rotation',
      'corner:tl:x', 'corner:br:y', 'mesh:1:1:x', 'sketch:size', 'sketch:trails', 'shader:speed', 'fx:fx1:blurRadius', 'fx:fx1:opacity', 'edge:e1:opacity',
      'look:intensity', 'look:react', 'look:chase', 'look:corner']) {
      expect(keys, key).toContain(key);
    }
    expect(keys).not.toContain('sketch:tint');
    const video = { ...createLayer('V', 'v'), source: { id: 'v', type: 'video', src: 'a.mp4', name: 'a', playbackRate: 1 } } as Layer;
    expect(layerParams(video).map((p) => p.key)).toContain('video:rate');
    const gpuKeys = layerParams(gpuLayer()).filter((p) => p.key.startsWith('gpu:'));
    expect(gpuKeys.length).toBeGreaterThan(0);
  });

  it('kinds: blend is stepped over the blend order, visibility bool, long shader inputs stepped', () => {
    const params = new Map(layerParams(richLayer()).map((p) => [p.key, p]));
    expect(params.get('layer:blend')).toMatchObject({ kind: 'stepped', min: 0, max: BLEND_MODE_ORDER.length - 1, step: 1, default: BLEND_MODE_ORDER.indexOf('screen') });
    expect(params.get('layer:visible')?.kind).toBe('bool');
    expect(params.get('shader:count')?.kind).toBe('stepped');
    expect(params.get('shader:speed')?.kind).toBe('continuous');
    const next = { ...richLayer() };
    applyParamOverrides(next, { 'layer:blend': 1.4 });
    expect(next.blendMode).toBe(BLEND_MODE_ORDER[1]);
    applyParamOverrides(next, { 'layer:blend': 999 });
    expect(next.blendMode).toBe(BLEND_MODE_ORDER[BLEND_MODE_ORDER.length - 1]);
  });

  it('gpu keys now apply (they were discovered but dropped on the native engine)', () => {
    const layer = gpuLayer();
    const next = { ...layer };
    applyParamOverrides(next, { 'gpu:rotationSpeed': 0.7 });
    expect((next as any).gpuLayerContent.params.rotationSpeed).toBe(0.7);
    expect((layer as any).gpuLayerContent.params.rotationSpeed).toBeUndefined();
    expect(next.gpuLayerContent!.shaderId).toBe('planet');
  });

  it('copies each nested object once and keeps the source id', () => {
    const layer = richLayer();
    const next = { ...layer };
    applyParamOverrides(next, { 'corner:tl:x': 0.3, 'corner:tl:y': 0.4, 'mesh:0:0:x': 0.5, 'sketch:size': 50 });
    expect(next.corners).not.toBe(layer.corners);
    expect(next.corners.topRight).toBe(layer.corners.topRight);
    expect(next.corners.topLeft).toEqual({ x: 0.3, y: 0.4 });
    expect(next.meshGrid!.points[1]).toBe(layer.meshGrid!.points[1]);
    expect(next.source!.id).toBe('src');
    expect(next.source!.jsAnimation!.paramValues).toEqual({ size: 50 });
  });

  it('transform keys move, scale and turn the piece about its centre, after corner keys', () => {
    const layer = { ...richLayer(), corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 0.5, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0 } } } as Layer;
    const moved = { ...layer };
    applyParamOverrides(moved, { 'transform:x': 0.5 });
    expect(moved.corners.topLeft).toEqual({ x: 0.5, y: 1 });
    expect(moved.corners.bottomRight).toEqual({ x: 1, y: 0 });
    const scaled = { ...layer };
    applyParamOverrides(scaled, { 'transform:scale': 0.5 });
    expect(scaled.corners.topLeft.x).toBeCloseTo(0.125);
    expect(scaled.corners.topLeft.y).toBeCloseTo(0.75);
    const turned = { ...layer };
    applyParamOverrides(turned, { 'transform:rotation': 90 });
    // A quarter turn on a 16:9 output: the 0.5-wide piece stands up, about its centre.
    const w = Math.abs(turned.corners.topRight.x - turned.corners.topLeft.x);
    const h = Math.abs(turned.corners.topRight.y - turned.corners.topLeft.y);
    expect(w).toBeCloseTo(0);
    expect(h).toBeCloseTo(0.5 * 16 / 9);
    // A corner key and a move in one set: the corner first, then the move.
    const both = { ...layer };
    applyParamOverrides(both, { 'transform:y': 0.1, 'corner:tl:x': 0.2 });
    expect(both.corners.topLeft.x).toBeCloseTo(0.2);
    expect(both.corners.topLeft.y).toBeCloseTo(1.1);
    expect(layer.corners.topLeft).toEqual({ x: 0, y: 1 });
    // Applied again to its own output (a re-flushed scene), it does not add up.
    applyParamOverrides(moved, { 'transform:x': 0.5 });
    expect(moved.corners.topLeft).toEqual({ x: 0.5, y: 1 });
    // Mesh points move with the corners.
    expect(moved.meshGrid!.points[0][0].x).toBeCloseTo(layer.meshGrid!.points[0][0].x + 0.5);
  });

  it('Stage FX and LED keys discover, apply and read back', () => {
    const composition = { enabled: true, effects: [{ id: 'b1', type: 'bloom', enabled: true, opacity: 1, params: { amount: 0.2 } } as any], stageEffects: [], activeStageEffectId: null, stageEffectAutomation: {} as any };
    const stage = stageParams({ mappingComposition: composition });
    expect(stage.map((p) => p.key)).toEqual(expect.arrayContaining(['stage:fx:b1:enabled', 'stage:fx:b1:opacity']));
    const fx = applyStageOverrides(composition.effects, { 'stage:fx:b1:opacity': 0.25, 'stage:fx:b1:amount': 0.9 });
    expect(fx[0]).toMatchObject({ opacity: 0.25, params: { amount: 0.9 } });
    expect(composition.effects[0].opacity).toBe(1);
    // Same input and values: the same output list (identity holds).
    expect(applyStageOverrides(composition.effects, { 'stage:fx:b1:opacity': 0.25, 'stage:fx:b1:amount': 0.9 })).toBe(fx);

    const controller: WLEDController = { id: 'c1', name: 'Strip', ipAddr: '1.2.3.4', port: 21324, ledCount: 10, enabled: true, brightness: 1 };
    const effect: WLEDEffect = { ...createWLEDEffect('chase'), id: 'w1', color: '#ff0000' };
    const leds = ledParams({ wledControllers: [controller], wledEffects: [effect] });
    const byKey = new Map(leds.map((p) => [p.key, p]));
    expect(byKey.get('led:c1:brightness')?.kind).toBe('continuous');
    expect(byKey.get('ledfx:w1:color')).toMatchObject({ kind: 'colour', default: 0xff0000 });
    expect(byKey.get('ledfx:w1:active')?.kind).toBe('bool');
    expect(applyLedControllerOverrides(controller, { 'led:c1:brightness': 0.3 }).brightness).toBe(0.3);
    expect(applyLedControllerOverrides(controller, {})).toBe(controller);
    const [e] = applyLedEffectOverrides([effect], { 'ledfx:w1:color': 0x00ff80, 'ledfx:w1:amount': 0.4, 'ledfx:w1:width': 0.9 });
    expect(e).toMatchObject({ color: '#00ff80', amount: 0.4, params: expect.objectContaining({ width: 0.9 }) });
    expect(colorHex(0x0000ff)).toBe('#0000ff');
    expect(readStageLedParam('ledfx:w1:color', null, [controller], [effect])).toBe(0xff0000);
    expect(readParam({ layers: [], wledControllers: [controller] }, { scope: 'led' }, 'led:c1:brightness')).toBe(1);
  });
});
