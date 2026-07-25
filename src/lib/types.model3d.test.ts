import { describe, expect, it } from 'vitest';
import { createDefaultModel3DContent } from './types';

describe('model3d material defaults', () => {
  it('preserves materials and textures embedded in imported models', () => {
    expect(createDefaultModel3DContent().materialType).toBe('source');
  });
});
