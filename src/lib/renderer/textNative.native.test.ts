import { describe, expect, it } from 'vitest';
import {
  TEXT_GLYPH_VEC4S,
  TEXT_HEADER_VEC4S,
  TEXT_MAX_GLYPHS,
  TEXT_NATIVE_SHADER_ID,
  TEXT_NATIVE_WGSL,
  TEXT_UNIFORM_BYTES,
  buildTextNativePrecompileCommands,
  parseCssColor,
  textNativeAtlasSourceId,
} from './textNative';

describe('native Text graph', () => {
  it('pins the render contract', () => {
    expect(TEXT_NATIVE_SHADER_ID).toBe('text/render-v1');
    expect(TEXT_NATIVE_WGSL).toContain('fn vs_glyph');
    expect(TEXT_NATIVE_WGSL).toContain('fn fs_glyph');
    expect(TEXT_NATIVE_WGSL).toContain(
      `array<vec4<f32>, ${TEXT_MAX_GLYPHS * TEXT_GLYPH_VEC4S}>`,
    );
    expect(TEXT_NATIVE_WGSL).toContain('var atlas_tex: texture_2d<f32>');
    expect(TEXT_NATIVE_WGSL).toContain('var atlas_smp: sampler');
    expect(TEXT_UNIFORM_BYTES).toBe(
      (TEXT_HEADER_VEC4S + TEXT_MAX_GLYPHS * TEXT_GLYPH_VEC4S) * 16,
    );
  });

  it('derives a stable per-layer atlas source id', () => {
    expect(textNativeAtlasSourceId('gpu:layer-1:text')).toBe('gpu:layer-1:text:text-atlas');
  });

  it('parses the CSS color formats the text panel produces', () => {
    expect(parseCssColor('#ffffff')).toEqual([1, 1, 1, 1]);
    expect(parseCssColor('#f00')).toEqual([1, 0, 0, 1]);
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0]);
    const rgba = parseCssColor('rgba(255, 128, 0, 0.5)');
    expect(rgba[0]).toBeCloseTo(1);
    expect(rgba[1]).toBeCloseTo(128 / 255);
    expect(rgba[3]).toBeCloseTo(0.5);
  });

  it('precompiles the text shader contract', () => {
    expect(buildTextNativePrecompileCommands()).toEqual([
      expect.objectContaining({
        type: 'precompile_shader',
        shader_id: TEXT_NATIVE_SHADER_ID,
        stage: 'render',
        entry: 'fs_glyph',
      }),
    ]);
  });
});
