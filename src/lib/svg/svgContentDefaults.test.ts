import { describe, expect, it } from 'vitest';
import { createDefaultSVGContent, createLegacySVGContent, type SVGContent } from '../types';
import { buildSvgNativeComputeGraph } from '../renderer/svgNative';
import { normalizeStoredSVGContent } from './svgContentDefaults';

const SQUARE = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#f00"/></svg>';

function header(content: SVGContent): number[] {
  const graph = buildSvgNativeComputeGraph({
    sourceId: 'defaults-test',
    content,
    width: 640,
    height: 360,
    time: 1.37,
    frameDelta: 1 / 60,
    frameIndex: 1,
    rasterReady: true,
  } as Parameters<typeof buildSvgNativeComputeGraph>[0]);
  return Array.from(graph.config.buffers[0].initial_f32 as ArrayLike<number>);
}

describe('new SVG layers', () => {
  it('start as the artwork drawn as-is', () => {
    const d = createDefaultSVGContent();
    expect(d.renderMode).toBe('source');
    expect(d.bloomStrength).toBe(0);
    expect(d.vignette).toBe(0);
    expect(d.chromatic).toBe(0);
    for (const [key, value] of Object.entries(d)) {
      if (key.endsWith('Enabled') && key !== 'bevelEnabled') expect(value, key).toBe(false);
    }
  });
});

describe('opening an older project', () => {
  it('fills every missing field with what the renderer drew for it', () => {
    const modes: SVGContent['renderMode'][] = ['source', 'flat', 'extrude'];
    const keys = Object.keys(createLegacySVGContent()).filter((k) => k !== 'svgSource');
    for (const base of [createLegacySVGContent(), createDefaultSVGContent()]) {
      for (const mode of modes) {
        for (const key of keys) {
          const stored = { ...base, svgSource: SQUARE, renderMode: mode } as Record<string, unknown>;
          delete stored[key];
          const before = header(stored as unknown as SVGContent);
          const after = header(normalizeStoredSVGContent(stored));
          expect(after, `${mode} without ${key}`).toEqual(before);
        }
      }
    }
  });

  it('draws a nearly empty old file exactly as before', () => {
    const stored = { svgSource: SQUARE };
    expect(header(normalizeStoredSVGContent(stored))).toEqual(header(stored as unknown as SVGContent));
  });

  it('keeps every stored value and gives the panel a value for every field', () => {
    const stored = { svgSource: SQUARE, bloomStrength: 1.8, renderMode: 'flat', liquidEnabled: true };
    const out = normalizeStoredSVGContent(stored);
    expect(out.bloomStrength).toBe(1.8);
    expect(out.renderMode).toBe('flat');
    expect(out.liquidEnabled).toBe(true);
    for (const key of Object.keys(createLegacySVGContent())) {
      expect(out[key as keyof SVGContent], key).not.toBeUndefined();
    }
  });

  it('reads a null (a NaN that went through JSON) as the renderer does', () => {
    const stored = { ...createLegacySVGContent(), svgSource: SQUARE, extrudeDepth: null, glowEnabled: null, fillMode: null };
    const out = normalizeStoredSVGContent(stored);
    expect(out.extrudeDepth).toBe(0);
    expect(header(out)).toEqual(header(stored as unknown as SVGContent));
  });

  it('copes with no settings at all', () => {
    expect(normalizeStoredSVGContent(undefined).svgSource).toBe('');
    expect(normalizeStoredSVGContent(null).renderMode).toBe('source');
  });
});
