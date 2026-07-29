import { describe, expect, it } from 'vitest';
import { createLayer } from '../types';
import { discoverKeyframeableParams } from './paramDiscovery';

describe('splat keyframe parameter discovery', () => {
  it('exposes splat controls with their shared ranges and groups', () => {
    const layer = createLayer('splat-test', 'Splat Test', 'splat');
    const params = discoverKeyframeableParams(layer);

    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'splat:pointSize',
          group: 'Splat · Rendering',
        }),
        expect.objectContaining({
          key: 'splat:positionZ',
          group: 'Splat · Transform',
        }),
        expect.objectContaining({
          key: 'splat:animationIntensity',
          group: 'Splat · Animation',
        }),
        expect.objectContaining({
          key: 'splat:keyLightIntensity',
          group: 'Splat · Lighting',
        }),
      ]),
    );
  });
});
