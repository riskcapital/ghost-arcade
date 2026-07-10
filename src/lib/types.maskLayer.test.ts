import { describe, expect, it } from 'vitest';
import { createLayer } from './types';

describe('mask-only layers', () => {
  it('start enabled without a media source', () => {
    const layer = createLayer('mask-1', 'Mask 1', 'mask');

    expect(layer.type).toBe('mask');
    expect(layer.source).toBeNull();
    expect(layer.mask).toEqual({
      enabled: true,
      shapes: [],
      inverted: false,
      feather: 0,
    });
  });

  it('does not initialize media-only shape content', () => {
    const layer = createLayer('mask-2', 'Mask 2', 'mask');
    expect(layer.layerShape).toBeNull();
  });
});
