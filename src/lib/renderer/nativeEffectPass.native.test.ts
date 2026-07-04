import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_EFFECT_PASS_MANIFEST,
  NATIVE_EFFECT_PASS_SHADER_ID,
  buildNativeEffectPassChainGraph,
  buildNativeEffectPassGraph,
  buildNativeEffectPassPrecompileCommands,
  getNativeEffectPassShaderSource,
  nativeEffectPassManifestEntry,
  packNativeEffectPassUniforms,
} from './nativeEffectPass';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<string>;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('native render-core stdio was not initialized');
  }

  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, {
    method: string;
    timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line) as {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id as number);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const send: NativeRpc['send'] = (method, params = {}, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native render-core timed out handling ${method}: ${stderr.trim()}`));
      }, timeoutMs);
      pending.set(id, { method, timer, resolve, reject });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  return {
    send,
    async close() {
      try {
        await send('shutdown', {}, 1000);
      } catch {
        // The process may already be gone after a failed assertion.
      }
      child.kill();
      return stderr.trim();
    },
  };
}

function makeSourceBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      bytes[offset] = Math.round(32 + (x / Math.max(1, width - 1)) * 160);
      bytes[offset + 1] = Math.round(16 + (y / Math.max(1, height - 1)) * 180);
      bytes[offset + 2] = Math.round(48 + (((x + y) % 9) / 8) * 128);
      bytes[offset + 3] = 255;
    }
  }
  return bytes;
}

function assertVisibleSnapshot(label: string, snapshot: Record<string, unknown>, minLuma = 0.02) {
  expect(snapshot.dark_frame, label).toBe(false);
  expect(Number(snapshot.average_luma ?? 0), label).toBeGreaterThan(minLuma);
  expect(Number(snapshot.nonzero_pixels ?? 0), label).toBeGreaterThan(0);
  expect(String(snapshot.checksum ?? ''), label).toHaveLength(16);
}

describe('Native effect-pass template', () => {
  it('exposes a small parity-ready pilot manifest', () => {
    expect(NATIVE_EFFECT_PASS_MANIFEST.map((entry) => [entry.id, entry.code])).toEqual([
      ['invert', 1],
      ['grayscale', 2],
      ['brightness', 3],
      ['contrast', 4],
      ['gamma', 5],
      ['saturation', 6],
      ['hue', 7],
      ['posterize', 8],
      ['noise', 9],
      ['pixelate', 10],
    ]);
    expect(nativeEffectPassManifestEntry('posterize')).toMatchObject({
      code: 8,
      defaultAmount: 6,
    });
  });

  it('exposes one fullscreen source-frame sampling WGSL shader', () => {
    const source = getNativeEffectPassShaderSource();
    expect(source.shaderId).toBe(NATIVE_EFFECT_PASS_SHADER_ID);
    expect(source.stage).toBe('render');
    expect(source.entry).toBe('fs_effect');
    expect(source.source).toContain('var source_tex: texture_2d<f32>');
    expect(source.source).toContain('var source_sampler: sampler');
    expect(source.source).toContain('fn vs_full');
    expect(source.source).toContain('fn fs_effect');
    expect(source.source).not.toMatch(/^\s*#include\b/m);
  });

  it('builds native precompile commands from the same shader bundle', () => {
    const source = getNativeEffectPassShaderSource();
    expect(buildNativeEffectPassPrecompileCommands()).toEqual([{
      type: 'precompile_shader',
      shader_id: source.shaderId,
      stage: source.stage,
      entry: source.entry,
      source: source.source,
    }]);
  });

  it('packs a stable 64-byte effect uniform block', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'noise',
      width: 640,
      height: 360,
      time: 1.25,
      frameDelta: 1 / 30,
      frameIndex: 12,
      amount: 0.4,
      mix: 0.75,
      params: { scale: 0.5, seed: 9 },
    })).toEqual([
      640,
      360,
      1.25,
      1 / 30,
      9,
      0.4,
      0.75,
      12,
      0.5,
      9,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  it('packs native pixelate effect params into the generic param slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'pixelate',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 12,
      params: {
        mode: 3,
        gridLines: 0.25,
        animSpeed: 0.5,
        animAmount: 0.75,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      10,
      12,
      1,
      3,
      3,
      0.25,
      0.5,
      0.75,
      0,
      0,
      0,
      0,
    ]);
  });

  it('builds a source-frame to source-frame render graph', () => {
    const graph = buildNativeEffectPassGraph({
      sourceId: 'gpu:layer-a:source',
      targetSourceId: 'gpu:layer-a:effect:invert',
      effect: 'invert',
      width: 1280,
      height: 720,
      time: 3,
      frameDelta: 1 / 60,
      frameIndex: 180,
      amount: 0.8,
    });

    expect(graph.config.passes).toEqual([]);
    expect(graph.config.readbacks).toEqual([]);
    expect(graph.config.buffers).toEqual([
      expect.objectContaining({
        id: 'effect-pass:gpu:layer-a:effect:invert:uniform',
        kind: 'uniform',
        byte_length: 64,
        initial_f32: expect.arrayContaining([1280, 720, 3, 1 / 60, 1, 0.8, 1, 180]),
      }),
    ]);
    expect(graph.config.render_passes).toEqual([
      expect.objectContaining({
        name: 'effect-pass-invert',
        shader_id: NATIVE_EFFECT_PASS_SHADER_ID,
        target: 'source_frame',
        source_id: 'gpu:layer-a:effect:invert',
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_effect',
        vertex_count: 3,
        instance_count: 1,
        clear: true,
        blend: 'replace',
      }),
    ]);
    expect(graph.config.render_passes[0].bindings).toEqual([
      { binding: 0, kind: 'source-frame-texture', source_id: 'gpu:layer-a:source' },
      { binding: 1, kind: 'source-frame-sampler' },
      { binding: 2, resource: 'effect-pass:gpu:layer-a:effect:invert:uniform', kind: 'uniform' },
    ]);
  });

  it('builds an ordered source-frame render graph for effect chains', () => {
    const graph = buildNativeEffectPassChainGraph({
      sourceId: 'gpu:layer-a:source',
      targetSourceId: 'gpu:layer-a:effect:final',
      intermediatePrefix: 'gpu:layer-a:chain',
      effects: [
        { effect: 'invert', amount: 1 },
        {
          effect: 'pixelate',
          amount: 12,
          params: {
            mode: 1,
            gridLines: 0.25,
            animSpeed: 0.5,
            animAmount: 0.75,
          },
        },
      ],
      width: 1280,
      height: 720,
      time: 3,
      frameDelta: 1 / 60,
      frameIndex: 180,
      seq: 900,
    });

    expect(graph.effects).toEqual(['invert', 'pixelate']);
    expect(graph.config.passes).toEqual([]);
    expect(graph.config.readbacks).toEqual([]);
    expect(graph.config.buffers).toHaveLength(2);
    expect(graph.config.render_passes).toHaveLength(2);
    expect(graph.config.render_passes[0]).toMatchObject({
      name: 'effect-pass-invert-1',
      source_id: 'gpu:layer-a:chain:step:0',
      seq: 900,
    });
    expect(graph.config.render_passes[1]).toMatchObject({
      name: 'effect-pass-pixelate-2',
      source_id: 'gpu:layer-a:effect:final',
      seq: 901,
    });
    expect(graph.config.buffers[1]).toEqual(expect.objectContaining({
      initial_f32: expect.arrayContaining([1280, 720, 3, 1 / 60, 10, 12, 1, 180, 1, 0.25, 0.5, 0.75]),
    }));
    expect(graph.config.render_passes[0].bindings).toEqual(expect.arrayContaining([
      { binding: 0, kind: 'source-frame-texture', source_id: 'gpu:layer-a:source' },
    ]));
    expect(graph.config.render_passes[1].bindings).toEqual(expect.arrayContaining([
      { binding: 0, kind: 'source-frame-texture', source_id: 'gpu:layer-a:chain:step:0' },
    ]));
  });

  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

  itIfNativeCore('renders an uploaded source frame through the native effect-pass graph', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', {
        config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: 160,
          height: 90,
          target_fps: 30,
        },
      }, 12000);
      await delay(80);

      const capabilities = await rpc.send('capabilities', {}, 5000);
      expect(capabilities?.features?.compute_graph_render).toBe(true);
      expect(capabilities?.features?.compute_graph_source_frame_target).toBe(true);
      const precompileSummary = await rpc.send('submit_commands', {
        commands: buildNativeEffectPassPrecompileCommands(),
      }, 5000);
      expect(Number(precompileSummary?.dropped ?? 0)).toBe(0);

      const sourceId = 'native-effect-pass-test-source';
      const targetSourceId = 'native-effect-pass-test-output';
      const layerId = 'native-effect-pass-test-layer';
      const sourceBytes = makeSourceBytes(32, 32);
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upload_source_frame',
            source_id: sourceId,
            width: 32,
            height: 32,
            rgba_b64: Buffer.from(sourceBytes).toString('base64'),
            seq: 1,
          },
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            blend_mode: 'normal',
            opacity: 1,
            corners: FULLSCREEN_CORNERS,
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: sourceId,
            uri: 'native-effect-pass-test://source',
            source_type: 'image',
          },
        ],
      }, 5000);

      const sourceSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0,
        frame_index: 1,
      }, 8000);
      assertVisibleSnapshot('effect pass source layer', sourceSnapshot);

      const graph = buildNativeEffectPassGraph({
        sourceId,
        targetSourceId,
        effect: 'invert',
        width: 160,
        height: 90,
        time: 0.2,
        frameDelta: 1 / 30,
        frameIndex: 2,
        amount: 1,
        mix: 1,
      });
      const graphResult = await rpc.send('compute_graph', graph.config, 8000);
      expect(graphResult?.render).toMatchObject({
        target: 'source_frame',
        source_id: targetSourceId,
      });
      expect(Number(graphResult?.render?.source_slot ?? -1)).toBeGreaterThanOrEqual(0);

      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: targetSourceId,
            uri: 'native-effect-pass-test://invert',
            source_type: 'image',
          },
        ],
      }, 5000);
      const effectSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.2,
        frame_index: 2,
      }, 8000);
      assertVisibleSnapshot('effect pass output layer', effectSnapshot);
      expect(effectSnapshot.checksum).not.toBe(sourceSnapshot.checksum);

      const status = await rpc.send('status', {}, 5000);
      expect(Number(status?.compute_graph_source_frame_renders ?? 0)).toBeGreaterThan(0);
    } finally {
      await rpc.close();
    }
  }, 30000);

  itIfNativeCore('renders an ordered native effect-pass chain in one compute graph', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', {
        config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: 160,
          height: 90,
          target_fps: 30,
        },
      }, 12000);
      await delay(80);

      const capabilities = await rpc.send('capabilities', {}, 5000);
      expect(capabilities?.features?.compute_graph_render).toBe(true);
      expect(capabilities?.features?.compute_graph_source_frame_target).toBe(true);
      const precompileSummary = await rpc.send('submit_commands', {
        commands: buildNativeEffectPassPrecompileCommands(),
      }, 5000);
      expect(Number(precompileSummary?.dropped ?? 0)).toBe(0);

      const sourceId = 'native-effect-pass-chain-source';
      const targetSourceId = 'native-effect-pass-chain-output';
      const layerId = 'native-effect-pass-chain-layer';
      const sourceBytes = makeSourceBytes(32, 32);
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upload_source_frame',
            source_id: sourceId,
            width: 32,
            height: 32,
            rgba_b64: Buffer.from(sourceBytes).toString('base64'),
            seq: 1,
          },
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            blend_mode: 'normal',
            opacity: 1,
            corners: FULLSCREEN_CORNERS,
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: sourceId,
            uri: 'native-effect-pass-chain-test://source',
            source_type: 'image',
          },
        ],
      }, 5000);

      const sourceSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0,
        frame_index: 1,
      }, 8000);
      assertVisibleSnapshot('effect pass chain source layer', sourceSnapshot);

      const graph = buildNativeEffectPassChainGraph({
        sourceId,
        targetSourceId,
        intermediatePrefix: 'native-effect-pass-chain-step',
        effects: [
          { effect: 'invert', amount: 1 },
          {
            effect: 'pixelate',
            amount: 8,
            params: {
              mode: 1,
              gridLines: 0.2,
              animSpeed: 0,
              animAmount: 0,
            },
          },
        ],
        width: 160,
        height: 90,
        time: 0.4,
        frameDelta: 1 / 30,
        frameIndex: 4,
        seq: 40,
      });
      const graphResult = await rpc.send('compute_graph', graph.config, 8000);
      expect(graphResult?.renders).toHaveLength(2);
      expect(graphResult?.renders?.[0]).toMatchObject({
        target: 'source_frame',
        source_id: 'native-effect-pass-chain-step:step:0',
      });
      expect(graphResult?.renders?.[1]).toMatchObject({
        target: 'source_frame',
        source_id: targetSourceId,
      });

      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: targetSourceId,
            uri: 'native-effect-pass-chain-test://output',
            source_type: 'image',
          },
        ],
      }, 5000);
      const effectSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.4,
        frame_index: 4,
      }, 8000);
      assertVisibleSnapshot('effect pass chain output layer', effectSnapshot);
      expect(effectSnapshot.checksum).not.toBe(sourceSnapshot.checksum);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
