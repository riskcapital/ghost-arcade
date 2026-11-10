/**
 * Lines reach more than the mapping pieces: an added layer (sub-row) has
 * lines of its own, a block's lines act on whichever layer shows that block
 * (only while it plays), a look block's lines act on its own effects, and a
 * piece off the stage takes its lines through the Timeline's copy.
 */
import { describe, expect, it } from 'vitest';
import type { Layer } from '../../types';
import { createLineEvaluator, type LineFrame } from './lineEvaluator';
import { normalizeLines, type ControlLine } from './lineModel';
import { applyLookLines, lineBlockValues, lineLayerValues, wearsLookWithLines } from './lineTargets';
import { lookBlockParams, paramsFor, readParam, subRowPieceId, targetId, type RegistrySource } from './paramRegistry';
import { applyParamOverrides } from '../../keyframes/applyParamOverrides';

const line = (over: Partial<ControlLine>): ControlLine => ({
  id: 'l', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1,
  points: [{ t: 0, v: 0 }, { t: 10, v: 1 }], ...over,
});

function frameOf(lines: ControlLine[], t: number): LineFrame {
  return createLineEvaluator().evaluate(lines, t);
}

function shape(id: string): Layer {
  return {
    id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal',
    source: { id: `src-${id}`, type: 'shader', src: 'x.fs', name: 'x', shaderValues: { amount: 0.5 } },
    corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } },
  } as unknown as Layer;
}

describe('line targets', () => {
  it('evaluates block and look lines into their own maps', () => {
    const f = frameOf([
      line({ id: 'a' }),
      line({ id: 'b', target: { scope: 'block', id: 'clip1' }, key: 'shader:amount' }),
      line({ id: 'c', target: { scope: 'look', id: 'look1' }, key: 'look:intensity', max: 2 }),
    ], 5);
    expect(f.layers.get('A')?.['layer:opacity']).toBeCloseTo(0.5);
    expect(f.blocks?.get('clip1')?.['shader:amount']).toBeCloseTo(0.5);
    expect(f.looks?.get('look1')?.['look:intensity']).toBeCloseTo(0.5);
  });

  it('a piece off the stage takes its lines through its copy; an added layer has its own', () => {
    const f = frameOf([line({ id: 'a' }), line({ id: 's', target: { scope: 'layer', id: 'showsub::A::T1' }, points: [{ t: 0, v: 0.25 }] })], 5);
    expect(lineLayerValues(f, 'A')?.['layer:opacity']).toBeCloseTo(0.5);
    expect(lineLayerValues(f, 'showtrack::A')?.['layer:opacity']).toBeCloseTo(0.5);
    expect(lineLayerValues(f, 'showfade::A')?.['layer:opacity']).toBeCloseTo(0.5);
    expect(lineLayerValues(f, 'showsub::A::T1')?.['layer:opacity']).toBeCloseTo(0.25);
    expect(lineLayerValues(f, 'B')).toBeUndefined();
  });

  it('a block line reaches only the layer showing that block, and the shader value lands', () => {
    const f = frameOf([line({ id: 'b', target: { scope: 'block', id: 'clip1' }, key: 'shader:amount', points: [{ t: 0, v: 0.9 }] })], 1);
    const showing = { ...shape('A'), _showClipId: 'clip1' };
    const other = { ...shape('A'), _showClipId: 'clip2' };
    expect(lineBlockValues(f, other)).toBeUndefined();
    const values = lineBlockValues(f, showing)!;
    const next: any = { ...showing };
    applyParamOverrides(next, values);
    expect(next.source.shaderValues.amount).toBeCloseTo(0.9);
    expect((showing.source as any).shaderValues.amount).toBe(0.5);
  });

  it('a look block line scales only that block\'s effects, once', () => {
    const f = frameOf([line({ id: 'c', target: { scope: 'look', id: 'L1' }, key: 'look:intensity', max: 2, points: [{ t: 0, v: 0.5 }] }),
      line({ id: 'd', target: { scope: 'look', id: 'L1' }, key: 'look:speed', max: 4, points: [{ t: 0, v: 2 }] })], 1);
    const layer: any = {
      ...shape('A'),
      edgeEffects: {
        enabled: true,
        effects: [
          { id: 'showlook:L1:A:0', opacity: 0.8, fill: { speed: 1 }, animation: { speed: 3 } },
          { id: 'showlook:L2:A:0', opacity: 0.8 },
          { id: 'own', opacity: 1 },
        ],
      },
    };
    expect(wearsLookWithLines(f, layer)).toBe(true);
    const next: any = { ...layer };
    applyLookLines(next, f);
    expect(next.edgeEffects.effects[0].opacity).toBeCloseTo(0.4);
    expect(next.edgeEffects.effects[0].fill.speed).toBeCloseTo(2);
    expect(next.edgeEffects.effects[0].animation.speed).toBeCloseTo(6);
    expect(next.edgeEffects.effects[1].opacity).toBe(0.8);
    expect(next.edgeEffects.effects[2].opacity).toBe(1);
    expect(layer.edgeEffects.effects[0].opacity).toBe(0.8);
    // A list that comes through again does not scale twice.
    const again: any = { ...next };
    applyLookLines(again, f);
    expect(again.edgeEffects.effects[0].opacity).toBeCloseTo(0.4);
  });

  it('the registry knows block, look and sub-row targets', () => {
    const blockLayer = { ...shape('A'), source: { id: 'b', type: 'shader', src: 'g.fs', name: 'g', shaderInputs: [{ NAME: 'glow', TYPE: 'float', MIN: 0, MAX: 2, DEFAULT: 1 }], shaderValues: { glow: 1.5 } } } as unknown as Layer;
    const src: RegistrySource = {
      layers: [shape('A')],
      blockLayer: (id) => (id === 'clip1' ? blockLayer : null),
      hasLookBlock: (id) => id === 'L1',
    };
    const block = paramsFor(src, { scope: 'block', id: 'clip1' });
    expect(block.map((p) => p.key)).toEqual(['shader:glow']);
    expect(readParam(src, { scope: 'block', id: 'clip1' }, 'shader:glow')).toBe(1.5);
    expect(paramsFor(src, { scope: 'look', id: 'L1' }).map((p) => p.key)).toEqual(lookBlockParams().map((p) => p.key));
    expect(paramsFor(src, { scope: 'look', id: 'nope' })).toEqual([]);
    expect(subRowPieceId('showsub::A::T1')).toBe('A');
    const sub = paramsFor(src, { scope: 'layer', id: 'showsub::A::T1' });
    expect(sub.some((p) => p.key === 'layer:opacity')).toBe(true);
    expect(targetId({ scope: 'block', id: 'x' })).toBe('block:x');
    expect(targetId({ scope: 'look', id: 'x' })).toBe('look:x');
  });

  it('saves and reads the new targets, colour and name', () => {
    const raw = JSON.parse(JSON.stringify([
      line({ id: 'b', target: { scope: 'block', id: 'clip1' }, color: '#ff00aa', label: 'Glow' }),
      line({ id: 'c', target: { scope: 'look', id: 'L1' } }),
      { id: 'bad', key: 'x', target: { scope: 'block' } },
    ]));
    const back = normalizeLines(raw);
    expect(back.map((l) => l.id)).toEqual(['b', 'c']);
    expect(back[0].target).toEqual({ scope: 'block', id: 'clip1' });
    expect(back[0].color).toBe('#ff00aa');
    expect(back[0].label).toBe('Glow');
  });
});
