import { describe, expect, it } from 'vitest';
import {
  buildSmoke3DNativeComputeGraph,
  buildSmoke3DNativePrecompileCommands,
  getSmoke3DNativeShaderSources,
  SMOKE_3D_NATIVE_SHADER_IDS,
} from './webgpu3DSmoke';

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

  it('builds native precompile commands from the same shader bundle', () => {
    const sources = getSmoke3DNativeShaderSources();
    const commands = buildSmoke3DNativePrecompileCommands();

    expect(commands).toHaveLength(sources.length);
    for (const [index, command] of commands.entries()) {
      expect(command).toEqual({
        type: 'precompile_shader',
        shader_id: sources[index].shaderId,
        stage: sources[index].stage,
        entry: sources[index].entry,
        source: sources[index].source,
      });
    }
  });

  it('builds a native compute graph that renders real 3D smoke into a source frame', () => {
    const first = buildSmoke3DNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-3d',
      params: { gridSize: 32, emitterCount: 3, splatRate: 60 },
      width: 1280,
      height: 720,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 12,
      reset: true,
    });

    expect(first.grid).toBe(32);
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.passes.map((pass) => pass.shader_id)).toContain(SMOKE_3D_NATIVE_SHADER_IDS.splat);
    expect(first.config.passes.map((pass) => pass.shader_id)).toContain(SMOKE_3D_NATIVE_SHADER_IDS.jacobi);
    expect(first.config.passes).toHaveLength(25);
    expect(first.config.render).toMatchObject({
      shader_id: SMOKE_3D_NATIVE_SHADER_IDS.render,
      target: 'source_frame',
      source_id: 'gpu:layer-a:smoke-3d',
      seq: 12,
      include_snapshot: false,
    });
    expect(first.config.buffers.filter((buffer) => buffer.persistent)).toHaveLength(7);
    expect(first.config.buffers.some((buffer) => buffer.kind === 'uniform' && !!buffer.initial_b64)).toBe(true);

    const second = buildSmoke3DNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-3d',
      params: { gridSize: 32, emitterCount: 3, splatRate: 60 },
      width: 1280,
      height: 720,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 13,
      state: first.state,
    });

    expect(second.state.denFlip).not.toBe(first.state.denFlip);
    expect(second.config.buffers.filter((buffer) => buffer.persistent && buffer.clear)).toHaveLength(0);
    expect(second.config.render.source_id).toBe(first.config.render.source_id);
  });
});
