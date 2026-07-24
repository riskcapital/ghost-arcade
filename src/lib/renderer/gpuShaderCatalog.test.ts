import { describe, expect, it } from 'vitest';
import { getShaderDef, GPU_SHADER_CATALOG } from './gpuShaderCatalog';

describe('GPU shader catalog', () => {
  it('registers Warp Loom as a source-free native instrument', () => {
    const shader = getShaderDef('warp-loom');

    expect(shader).toBeDefined();
    expect(shader?.label).toBe('Warp Loom');
    expect(shader?.needsSource).toBe(false);
    expect(shader?.defaultParams).toMatchObject({
      structure: 'braid',
      webMix: 0.62,
      warpStrength: 0.82,
      turbulence: 0.76,
    });
    expect(GPU_SHADER_CATALOG.indexOf(shader!)).toBeGreaterThanOrEqual(0);
  });
});
