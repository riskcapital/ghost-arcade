import { describe, expect, it } from 'vitest';
import {
  MODEL3D_AUTOMATABLE_PARAM_MAP,
  MODEL3D_AUTOMATABLE_PARAMS,
} from './model3dParamSchema';

describe('model3dParamSchema', () => {
  it('has unique, valid numeric ranges', () => {
    expect(MODEL3D_AUTOMATABLE_PARAM_MAP.size).toBe(MODEL3D_AUTOMATABLE_PARAMS.length);
    for (const param of MODEL3D_AUTOMATABLE_PARAMS) {
      expect(param.max).toBeGreaterThan(param.min);
      expect(param.step).toBeGreaterThan(0);
    }
  });

  it('covers the transform, camera, and material controls', () => {
    for (const key of [
      'positionX',
      'rotationX',
      'scaleUniform',
      'camera.distance',
      'camera.orbitX',
      'echo.count',
      'materialRoughness',
    ]) {
      expect(MODEL3D_AUTOMATABLE_PARAM_MAP.has(key)).toBe(true);
    }
  });
});
