import { describe, expect, it } from 'vitest';
import type { SplatContent } from '../types';
import {
  baselineFragmentShader,
  baselineVertexShader,
  fragmentShader,
  requiresAdvancedSplatMaterial,
  vertexShader,
} from './SplatRenderer';

describe('SplatRenderer fragment shader contract', () => {
  it('declares every lighting and atmosphere uniform used by the fragment stage', () => {
    const uniforms = [
      'lightingEnabled',
      'ambientIntensity',
      'keyLightColor',
      'keyLightIntensity',
      'keyLightDirection',
      'rimLightColor',
      'rimLightIntensity',
      'rimLightDirection',
      'shadowStrength',
      'shadowSoftness',
      'specularStrength',
      'atmosphereEnabled',
      'atmosphereDensity',
      'atmosphereColor',
      'atmosphereScale',
      'atmosphereTurbulence',
      'atmosphereSpeed',
    ];

    for (const uniform of uniforms) {
      expect(fragmentShader).toMatch(new RegExp(`uniform\\s+\\w+\\s+${uniform}\\s*;`));
    }
  });

  it('keeps a default or legacy point cloud on the compact shader path', () => {
    const content = {
      animationType: 'none',
      displacementType: 'none',
      audioEnabled: false,
      slicePlane: { enabled: false },
      mouseInfluence: 0,
      textureEnabled: false,
      lightingEnabled: false,
      atmosphereEnabled: false,
    } as SplatContent;

    expect(requiresAdvancedSplatMaterial(content)).toBe(false);
    expect(requiresAdvancedSplatMaterial({ ...content, lightingEnabled: true })).toBe(false);
    expect(requiresAdvancedSplatMaterial({ ...content, animationType: 'orbit' })).toBe(true);
  });

  it('keeps the baseline shaders free of optional effect and lighting branches', () => {
    expect(baselineVertexShader).not.toContain('animationType');
    expect(baselineVertexShader).not.toContain('displacementType');
    expect(baselineFragmentShader).not.toContain('lightingEnabled');
    expect(baselineFragmentShader).not.toContain('atmosphereEnabled');
  });

  it('caps attenuated point diameter in both rendering paths', () => {
    expect(baselineVertexShader).toContain('uniform float maxPointSize;');
    expect(baselineVertexShader).toContain('clamp(size, 0.0, maxPointSize)');
    expect(vertexShader).toContain('uniform float maxPointSize;');
    expect(vertexShader).toContain('clamp(size, 0.0, maxPointSize)');
  });

  it('builds complete 3x3 transform matrices in the baseline shader', () => {
    expect(baselineVertexShader).toContain(
      'mat3 rotZ = mat3(cz, -sz, 0, sz, cz, 0, 0, 0, 1);',
    );
  });
});
