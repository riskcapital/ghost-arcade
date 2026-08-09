import { describe, expect, it } from 'vitest';
import {
  SPLAT_AUTOMATABLE_PARAM_MAP,
  SPLAT_AUTOMATABLE_PARAMS,
} from './splatParamSchema';

describe('splatParamSchema', () => {
  it('has unique, valid numeric ranges', () => {
    expect(SPLAT_AUTOMATABLE_PARAM_MAP.size).toBe(SPLAT_AUTOMATABLE_PARAMS.length);
    for (const param of SPLAT_AUTOMATABLE_PARAMS) {
      expect(param.max).toBeGreaterThan(param.min);
      expect(param.step).toBeGreaterThan(0);
    }
  });

  it('covers the core render, motion, lighting, and camera controls', () => {
    for (const key of [
      'pointSize',
      'positionZ',
      'animationSpeed',
      'displacementAmount',
      'audioSensitivity',
      'keyLightIntensity',
      'atmosphereDensity',
      'creativeEffectIntensity',
      'cameraDistance',
    ]) {
      expect(SPLAT_AUTOMATABLE_PARAM_MAP.has(key as never)).toBe(true);
    }
  });
});
