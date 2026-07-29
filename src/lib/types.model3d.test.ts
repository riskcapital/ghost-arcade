import { describe, expect, it } from 'vitest';
import { createDefaultModel3DContent } from './types';

describe('model3d material defaults', () => {
  it('preserves materials and textures embedded in imported models', () => {
    expect(createDefaultModel3DContent().materialType).toBe('source');
  });

  it('starts with a production lighting rig without covering lower layers', () => {
    const content = createDefaultModel3DContent();

    expect(content.environmentEnabled).toBe(true);
    expect(content.environmentIntensity).toBe(1);
    expect(content.toneMappingExposure).toBe(1);
    expect(content.backgroundMode).toBe('transparent');
    expect(content.backgroundOpacity).toBe(1);
    expect(content.shadowsEnabled).toBe(true);
    expect(content.shadowQuality).toBe('medium');
  });
});
