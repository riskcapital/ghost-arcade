import { describe, expect, it } from 'vitest';
import {
  buildVJMixGraph,
  buildVJMixUniformUpdate,
  VJ_MIX_BLEND_CODES,
  VJ_MIX_UNIFORM_BYTES,
  vjMixBlendModeCode,
} from './vjMixNative';

function baseOptions() {
  return {
    outputSourceId: 'plugin:__vj-mix__:vj-mix',
    rows: [
      { frameId: 'layer-frame:vj-layer-2', opacity: 0.85, blendMode: 'normal' },
      { frameId: 'layer-frame:vj-xfade-1', opacity: 1, blendMode: 'screen' },
      { frameId: 'layer-frame:vj-layer-0', opacity: 0.4, blendMode: 'add' },
    ],
    width: 1920,
    height: 1080,
    time: 12.5,
    frameIndex: 750,
  };
}

function decodeFloats(initialB64: string): Float32Array {
  const binary = atob(initialB64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

describe('native VJ mix graph', () => {
  it('stacks one pass per row and writes the composite into the output source', () => {
    const graph = buildVJMixGraph(baseOptions());
    const passes = graph.config.render_passes;

    expect(passes).toHaveLength(3);
    const last = passes[passes.length - 1];
    expect(last.source_id).toBe('plugin:__vj-mix__:vj-mix');
    expect(last.blend).toBe('replace');
    expect(last.vertex_count).toBe(3);
    expect(last.generate_mips).toBe(false);
    // Intermediates ping-pong between two step targets.
    expect(passes[0].source_id).toBe('plugin:__vj-mix__:vj-mix:step:0');
    expect(passes[1].source_id).toBe('plugin:__vj-mix__:vj-mix:step:1');
  });

  it('binds the accumulator at 2 and the row layer frame at 3', () => {
    const graph = buildVJMixGraph(baseOptions());
    const passes = graph.config.render_passes;

    // First pass has no accumulator yet — dst is allow_missing.
    expect(passes[0].bindings).toContainEqual({
      binding: 2,
      kind: 'source-frame-texture',
      allow_missing: true,
    });
    expect(passes[0].bindings).toContainEqual({
      binding: 3,
      kind: 'source-frame-texture',
      source_id: 'layer-frame:vj-layer-2',
    });
    expect(passes[1].bindings).toContainEqual({
      binding: 2,
      kind: 'source-frame-texture',
      source_id: 'plugin:__vj-mix__:vj-mix:step:0',
    });
    expect(passes[1].bindings).toContainEqual({
      binding: 3,
      kind: 'source-frame-texture',
      source_id: 'layer-frame:vj-xfade-1',
    });
    expect(passes[2].bindings).toContainEqual({
      binding: 3,
      kind: 'source-frame-texture',
      source_id: 'layer-frame:vj-layer-0',
    });
  });

  it('sequences mix passes after the same-frame crossfade passes', () => {
    const options = baseOptions();
    const graph = buildVJMixGraph(options);
    for (const [index, pass] of graph.config.render_passes.entries()) {
      expect(pass.seq).toBe(options.frameIndex * 16 + 8 + index);
      // Crossfade passes ride seq = frameIndex.
      expect(pass.seq).toBeGreaterThan(options.frameIndex);
    }
  });

  it('packs per-row opacity, blend code, and the clear flag into 48-byte uniforms', () => {
    const update = buildVJMixUniformUpdate(baseOptions());

    expect(update.buffers).toHaveLength(3);
    const first = decodeFloats(update.buffers[0].initialB64);
    expect(first.byteLength).toBe(VJ_MIX_UNIFORM_BYTES);
    expect(Array.from(first.slice(0, 6))).toEqual([
      1920,
      1080,
      0.8500000238418579,
      12.5,
      VJ_MIX_BLEND_CODES.normal,
      1,
    ]);
    const second = decodeFloats(update.buffers[1].initialB64);
    expect(second[2]).toBe(1);
    expect(second[4]).toBe(VJ_MIX_BLEND_CODES.screen);
    expect(second[5]).toBe(0);
    const third = decodeFloats(update.buffers[2].initialB64);
    expect(third[4]).toBe(VJ_MIX_BLEND_CODES.add);

    const graph = buildVJMixGraph(baseOptions());
    expect(graph.config.buffers.map((buffer) => buffer.id)).toEqual(
      update.buffers.map((buffer) => buffer.bufferId),
    );
  });

  it('mirrors the compositor blend vocabulary', () => {
    expect(vjMixBlendModeCode('normal')).toBe(0);
    expect(vjMixBlendModeCode('add')).toBe(1);
    expect(vjMixBlendModeCode('hard-light')).toBe(10);
    expect(vjMixBlendModeCode('hard_light')).toBe(10);
    expect(vjMixBlendModeCode('pin-light')).toBe(25);
    expect(vjMixBlendModeCode('luminosity')).toBe(18);
    expect(vjMixBlendModeCode('not-a-blend')).toBe(0);
  });

  it('does not reinstall merely because core-owned animation time advanced', () => {
    const first = buildVJMixUniformUpdate(baseOptions());
    const later = buildVJMixUniformUpdate({ ...baseOptions(), time: 99 });
    const faded = buildVJMixUniformUpdate({
      ...baseOptions(),
      rows: baseOptions().rows.map((row, index) => (index === 0 ? { ...row, opacity: 0.2 } : row)),
    });

    expect(later.signature).toBe(first.signature);
    expect(faded.signature).not.toBe(first.signature);
  });
});
