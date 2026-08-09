import { describe, expect, it } from 'vitest';
import type { Layer } from '../types';
import { activeMediaTargetLayerIds } from './mediaTargeting';

function layer(id: string, type: Layer['type'] = 'media'): Layer {
  return { id, type, name: id } as Layer;
}

describe('activeMediaTargetLayerIds', () => {
  it('targets only the active Mapping layer when multiple layers exist', () => {
    const layers = [layer('bottom'), layer('top')];

    expect(activeMediaTargetLayerIds('bottom', layers)).toEqual(['bottom']);
    expect(activeMediaTargetLayerIds('top', layers)).toEqual(['top']);
  });

  it('does not broadcast media to an invalid or unsupported selection', () => {
    expect(activeMediaTargetLayerIds('missing', [layer('media')])).toEqual([]);
    expect(activeMediaTargetLayerIds('color', [layer('color', 'color')])).toEqual([]);
  });
});
