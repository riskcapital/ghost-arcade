import { describe, expect, it } from 'vitest';
import { getSmoke3DNativeShaderSources, SMOKE_3D_NATIVE_SHADER_IDS } from './webgpu3DSmoke';

describe('3D Smoke native shader bundle', () => {
  it('exposes the real 3D Smoke WGSL passes with resolved includes', () => {
    const sources = getSmoke3DNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(7);
    for (const shaderId of Object.values(SMOKE_3D_NATIVE_SHADER_IDS)) {
      expect(byId.has(shaderId)).toBe(true);
    }

    for (const source of sources) {
      expect(source.source).toContain(source.entry);
      expect(source.source).not.toMatch(/^\s*#include\b/m);
      if (source.stage === 'compute') {
        expect(source.source).toContain('@compute');
      } else {
        expect(source.source).toContain('@vertex');
        expect(source.source).toContain('@fragment');
        expect(source.source).toContain('fn vs_main');
        expect(source.source).toContain('fn fs_main');
      }
    }
  });
});
