import { describe, expect, it } from 'vitest';
import { blendShaders } from './shaders';
import { addLayerBlendInfluenceUniform, layerBlendInfluence } from './blendOpacity';

describe('layerBlendInfluence', () => {
  it('eases in by half opacity and stays engaged while the layer fades out', () => {
    expect(layerBlendInfluence(1, 'screen')).toBe(0);
    expect(layerBlendInfluence(0.75, 'screen')).toBe(0.5);
    expect(layerBlendInfluence(0.5, 'screen')).toBe(1);
    expect(layerBlendInfluence(0.25, 'screen')).toBe(1);
    expect(layerBlendInfluence(0, 'screen')).toBe(1);
  });

  it('clamps out-of-range opacity and leaves normal mode unchanged', () => {
    expect(layerBlendInfluence(2, 'multiply')).toBe(0);
    expect(layerBlendInfluence(-1, 'multiply')).toBe(1);
    expect(layerBlendInfluence(0.5, 'normal')).toBe(0);
  });
});

describe('addLayerBlendInfluenceUniform', () => {
  it.each(Object.entries(blendShaders))('upgrades the %s shader to the shared contract', (_mode, shader) => {
    const upgraded = addLayerBlendInfluenceUniform(shader);
    expect(upgraded).toContain('uniform float uBlendInfluence;');
    expect(upgraded).toContain('vec3 normalComposite = mix(base.rgb, layer.rgb, a);');
    expect(upgraded).toContain('mix(normalComposite, blendComposite, uBlendInfluence)');
  });
});
