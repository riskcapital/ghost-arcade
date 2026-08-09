import { describe, expect, it } from 'vitest';
import {
  buildVJCrossfadeGraph,
  buildVJCrossfadeUniformUpdate,
  VJ_CROSSFADE_BLEND_IDS,
  VJ_CROSSFADE_TRANSITION_IDS,
  VJ_CROSSFADE_UNIFORM_BYTES,
} from './vjCrossfadeNative';

function baseOptions() {
  return {
    outputSourceId: 'plugin:vj-xfade-0:vj-crossfade',
    sourceAId: 'layer-frame:vj-A-0',
    sourceBId: 'layer-frame:vj-B-0',
    width: 1920,
    height: 1080,
    mix: 0.375,
    transition: 'glitch',
    blendMode: 'screen',
    opacityA: 0.65,
    opacityB: 0.35,
    time: 12.5,
    frameIndex: 750,
  };
}

function decodeFloats(initialB64: string): Float32Array {
  const binary = atob(initialB64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

describe('native VJ crossfade graph', () => {
  it('keeps every VJ transition available as a distinct native branch', () => {
    expect(Object.keys(VJ_CROSSFADE_TRANSITION_IDS)).toEqual([
      'dissolve',
      'wipe',
      'rgb-split',
      'cube',
      'shatter',
      'halftone',
      'glitch',
      'liquid',
      'strobe',
      'slide',
    ]);
    expect(new Set(Object.values(VJ_CROSSFADE_TRANSITION_IDS)).size).toBe(10);
  });

  it('binds the two bank layer frames to one native transition pass', () => {
    const graph = buildVJCrossfadeGraph(baseOptions());
    const pass = graph.config.render_passes[0];

    expect(pass.source_id).toBe('plugin:vj-xfade-0:vj-crossfade');
    expect(pass.bindings).toContainEqual({
      binding: 2,
      kind: 'source-frame-texture',
      source_id: 'layer-frame:vj-A-0',
    });
    expect(pass.bindings).toContainEqual({
      binding: 3,
      kind: 'source-frame-texture',
      source_id: 'layer-frame:vj-B-0',
    });
  });

  it('encodes live mix, transition, blend, and bank opacities in the stable uniform', () => {
    const update = buildVJCrossfadeUniformUpdate(baseOptions());
    const values = decodeFloats(update.initialB64);

    expect(values.byteLength).toBe(VJ_CROSSFADE_UNIFORM_BYTES);
    expect(Array.from(values.slice(0, 8))).toEqual([
      1920,
      1080,
      0.375,
      12.5,
      VJ_CROSSFADE_TRANSITION_IDS.glitch,
      VJ_CROSSFADE_BLEND_IDS.screen,
      0.6499999761581421,
      0.3499999940395355,
    ]);
    expect(update.bufferId).toBe(
      buildVJCrossfadeGraph(baseOptions()).config.buffers[0].id,
    );
  });

  it('does not reinstall merely because core-owned animation time advanced', () => {
    const first = buildVJCrossfadeUniformUpdate(baseOptions());
    const later = buildVJCrossfadeUniformUpdate({ ...baseOptions(), time: 99 });
    const moved = buildVJCrossfadeUniformUpdate({ ...baseOptions(), mix: 0.8 });
    const faded = buildVJCrossfadeUniformUpdate({ ...baseOptions(), opacityB: 0.1 });

    expect(later.signature).toBe(first.signature);
    expect(moved.signature).not.toBe(first.signature);
    expect(faded.signature).not.toBe(first.signature);
  });
});
