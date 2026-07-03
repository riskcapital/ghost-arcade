import { describe, expect, it } from 'vitest';
import { applyGpuShaderQualityBudget, getShaderDef } from './gpuShaderCatalog';

describe('applyGpuShaderQualityBudget', () => {
  it('caps expensive particle params without mutating user params', () => {
    const def = getShaderDef('particle-field');
    const params = { particleCount: 500000, partnerCount: 24, topology: 'glow' };

    const result = applyGpuShaderQualityBudget(def, params, {
      capsTier: 'high',
      suggestedTier: 'low',
      qualityScale: 0.75,
      adaptive: true,
    });

    expect(result.params).toEqual({
      particleCount: 75000,
      partnerCount: 6,
      topology: 'glow',
    });
    expect(params.particleCount).toBe(500000);
    expect(result.applied.particleCount).toEqual({ from: 500000, to: 75000, cap: 75000 });
  });

  it('preserves numeric string params for select-backed shader controls', () => {
    const def = getShaderDef('smoke-3d');

    const result = applyGpuShaderQualityBudget(def, {
      gridSize: '64',
      shadowSteps: 12,
      emitterCount: 8,
    }, {
      capsTier: 'ultra',
      suggestedTier: 'low',
      qualityScale: 1,
      adaptive: true,
    });

    expect(result.params.gridSize).toBe('32');
    expect(result.params.shadowSteps).toBe(2);
    expect(result.params.emitterCount).toBe(4);
  });
});
