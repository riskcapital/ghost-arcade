import { describe, expect, it } from 'vitest';
import { parseCubeLut } from './cubeLut';
import { cubeLutHandle, cubeLutForHandle, validateCubeLut } from './cubeLutAssets';
import { buildNativeEffectPassChainGraph, buildCompositeEffectPassChainGraph } from '../renderer/nativeEffectPass';
const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
describe('saved LUT assets and effect chains', () => {
  it('keeps asset handles stable while strength changes and validates restored data', () => {
    const asset = JSON.parse(JSON.stringify(parseCubeLut(text)));
    const handle = cubeLutHandle(asset);
    expect(cubeLutHandle(asset)).toBe(handle);
    expect(cubeLutForHandle(handle)).toEqual(asset);
    expect(() => validateCubeLut({ ...asset, rgba: [0] })).toThrow();
    expect(() => validateCubeLut({ ...asset, domainMax: [0, 1, 1] })).toThrow();
    expect(() => cubeLutForHandle(-1)).toThrow();
  });
  it('leaves unloaded LUTs fully bypassed, including HDR inputs', () => {
    const graph = buildNativeEffectPassChainGraph({ sourceId: 'i', targetSourceId: 'o', effects: [{ effect: 'cube-lut' }] });
    const uniform = graph.config.buffers.find(b => b.kind === 'uniform')!;
    expect(Buffer.from(uniform.initial_b64 as string, 'base64').readFloatLE(36)).toBe(0);
  });
  it.each([buildNativeEffectPassChainGraph, buildCompositeEffectPassChainGraph])('preserves chain order, GPU bindings, strength and target with LUT between other effects', build => {
    const asset = parseCubeLut(text);
    const handle = cubeLutHandle(asset);
    const graph = build({ sourceId: 'input', targetSourceId: 'output', effects: [{ effect: 'brightness' }, { effect: 'cube-lut', mix: .5, params: { lutHandle: handle, amount: .6 } }, { effect: 'contrast' }] });
    expect(graph.config.render_passes).toHaveLength(3);
    expect(graph.config.render_passes[1].shader_id).toBe('native-cube-lut-v1');
    const table = graph.config.buffers.find(b => b.immutable_lut);
    expect(table).toMatchObject({ persistent: true, byte_length: 128 });
    const bindings = graph.config.render_passes[1].bindings as any[];
    expect(bindings[3].resource).toBe(table!.id);
    const uniform = graph.config.buffers.find(b => b.id === bindings[2].resource)!;
    expect(uniform.byte_length).toBe(48);
    expect(Buffer.from(uniform.initial_b64 as string, 'base64').readFloatLE(36)).toBeCloseTo(.3);
  });
});
