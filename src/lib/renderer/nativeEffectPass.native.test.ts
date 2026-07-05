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

function snapshotPixels(snapshot: Record<string, unknown>): Uint8Array {
  expect(snapshot.includes_pixels).toBe(true);
  const data = typeof snapshot.rgba_b64 === 'string'
    ? Buffer.from(snapshot.rgba_b64, 'base64')
    : null;
  expect(data?.byteLength ?? 0).toBe(Number(snapshot.width) * Number(snapshot.height) * 4);
  return new Uint8Array(data ?? []);
}

function snapshotPixelLuma(snapshot: Record<string, unknown>, pixels: Uint8Array, xRatio: number, yRatio: number): number {
  const width = Math.max(1, Number(snapshot.width ?? 1));
  const height = Math.max(1, Number(snapshot.height ?? 1));
  const x = Math.max(0, Math.min(width - 1, Math.round((width - 1) * xRatio)));
  const y = Math.max(0, Math.min(height - 1, Math.round((height - 1) * yRatio)));
  const offset = (y * width + x) * 4;
  return (
    pixels[offset] * 0.299 +
    pixels[offset + 1] * 0.587 +
    pixels[offset + 2] * 0.114
  ) / 255;
}

function snapshotPixelRgb(snapshot: Record<string, unknown>, pixels: Uint8Array, xRatio: number, yRatio: number): [number, number, number] {
  const width = Math.max(1, Number(snapshot.width ?? 1));
  const height = Math.max(1, Number(snapshot.height ?? 1));
  const x = Math.max(0, Math.min(width - 1, Math.round((width - 1) * xRatio)));
  const y = Math.max(0, Math.min(height - 1, Math.round((height - 1) * yRatio)));
  const offset = (y * width + x) * 4;
  return [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
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
      ['vignette', 11],
      ['rgb-shift', 12],
      ['scanlines', 13],
      ['blur', 14],
      ['chromatic-aberration', 15],
      ['glitch', 16],
      ['exposure', 17],
      ['vibrance', 18],
      ['temperature-tint', 19],
      ['sharpen', 20],
      ['directional-blur', 21],
      ['zoom-blur', 22],
      ['radial-blur', 23],
      ['kaleidoscope', 24],
      ['mirror', 25],
      ['chroma-key', 26],
      ['luma-key', 27],
      ['difference-key', 28],
      ['erode', 29],
      ['dilate', 30],
      ['wave', 31],
      ['fisheye', 32],
      ['lens-distortion', 33],
      ['twirl', 34],
      ['pinch-bulge', 35],
      ['edge-detect', 36],
      ['film-grain', 37],
      ['filmic-tonemap', 38],
      ['bloom', 39],
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

  it('packs native vignette params across both generic param vec4 slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'vignette',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.72,
      params: {
        softness: 0.22,
        roundness: 0.9,
        shape: 3,
        aspect: 1.25,
        centerX: 0.45,
        centerY: 0.58,
        tintAmount: 0.2,
        breathing: 0.1,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      11,
      0.72,
      1,
      3,
      0.22,
      0.9,
      3,
      1.25,
      0.45,
      0.58,
      0.2,
      0.1,
    ]);
  });

  it('packs native stylize pilot params across the shared effect slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'glitch',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.9,
      params: {
        speed: 1.4,
        blockSize: 0.2,
        rgbSplit: 0.8,
        jitter: 0.55,
        verticalSlice: 0.3,
        blockHold: 0.1,
        tearChance: 0.7,
        triggerMode: 2,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      16,
      0.9,
      1,
      3,
      1.4,
      0.2,
      0.8,
      0.55,
      0.3,
      0.1,
      0.7,
      2,
    ]);
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'chromatic-aberration',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.6,
      params: {
        mode: 2,
        angle: 35,
        centerX: 0.45,
        centerY: 0.55,
        edgeFalloff: 0.8,
        outputMix: 0.7,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      15,
      0.6,
      1,
      3,
      2,
      35,
      0.45,
      0.55,
      0.8,
      0.7,
      0,
      0,
    ]);
  });

  it('packs native color correction params across the shared effect slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'exposure',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 1.25,
      params: {
        rollOff: 0.4,
        highlightProtect: 0.6,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      17,
      1.25,
      1,
      3,
      0.4,
      0.6,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'vibrance',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.8,
      params: {
        skinProtect: 0.25,
        highlightProtect: 0.45,
        ceiling: 1.2,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      18,
      0.8,
      1,
      3,
      0.25,
      0.45,
      1.2,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'temperature-tint',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: -0.35,
      params: {
        tint: 0.2,
        shadowTemp: -0.25,
        highlightTemp: 0.4,
        splitTone: 0.7,
        autoCycle: 0.9,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      19,
      -0.35,
      1,
      3,
      0.2,
      -0.25,
      0.4,
      0.7,
      0.9,
      0,
      0,
      0,
    ]);
  });

  it('packs native blur and symmetry params across the shared effect slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'directional-blur',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.75,
      params: {
        angle: 35,
        samples: 20,
        falloff: 0.4,
        centerBias: 0.2,
        outputMix: 0.9,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      21,
      0.75,
      1,
      3,
      35,
      20,
      0.4,
      0.2,
      0.9,
      0,
      0,
      0,
    ]);
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'kaleidoscope',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.8,
      params: {
        segments: 9,
        angle: 45,
        centerX: 0.4,
        centerY: 0.6,
        zoom: 1.25,
        mode: 2,
        spiral: 0.7,
        animSpeed: 0.2,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      24,
      0.8,
      1,
      3,
      9,
      45,
      0.4,
      0.6,
      1.25,
      2,
      0.7,
      0.2,
    ]);
  });

  it('packs native keying and morphology params across the shared effect slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'chroma-key',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.22,
      params: {
        keyR: 0.1,
        keyG: 0.8,
        keyB: 0.2,
        softness: 0.12,
        spill: 0.7,
        matte: 1,
        mode: 2,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      26,
      0.22,
      1,
      3,
      0.1,
      0.8,
      0.2,
      0.12,
      0.7,
      1,
      2,
      0,
    ]);

    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'erode',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 4,
      params: {
        shape: 2,
        channel: 4,
        outputMix: 0.65,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      29,
      4,
      1,
      3,
      2,
      4,
      0.65,
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  it('packs native distortion params across the shared effect slots', () => {
    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'wave',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 18,
      params: {
        mode: 2,
        waveform: 1,
        frequency: 12,
        speed: 1.4,
        phase: 90,
        secondary: 0.4,
        chromaSplit: 0.7,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      31,
      18,
      1,
      3,
      2,
      1,
      12,
      1.4,
      90,
      0.4,
      0.7,
      0,
    ]);

    expect(packNativeEffectPassUniforms({
      sourceId: 'src',
      targetSourceId: 'dst',
      effect: 'lens-distortion',
      width: 320,
      height: 180,
      time: 0.5,
      frameDelta: 1 / 24,
      frameIndex: 3,
      amount: 0.7,
      params: {
        mode: 3,
        centerX: 0.45,
        centerY: 0.55,
        cubic: -0.2,
        anamorphicX: 1.7,
        edgeFade: 0.8,
        chromatic: 0.3,
      },
    })).toEqual([
      320,
      180,
      0.5,
      1 / 24,
      33,
      0.7,
      1,
      3,
      3,
      0.45,
      0.55,
      -0.2,
      1.7,
      0.8,
      0.3,
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
        {
          effect: 'vignette',
          amount: 0.72,
          params: {
            softness: 0.22,
            roundness: 0.9,
            shape: 3,
            aspect: 1.25,
            centerX: 0.45,
            centerY: 0.58,
            tintAmount: 0.2,
            breathing: 0.1,
          },
        },
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

    expect(graph.effects).toEqual(['vignette', 'pixelate']);
    expect(graph.config.passes).toEqual([]);
    expect(graph.config.readbacks).toEqual([]);
    expect(graph.config.buffers).toHaveLength(2);
    expect(graph.config.render_passes).toHaveLength(2);
    expect(graph.config.render_passes[0]).toMatchObject({
      name: 'effect-pass-vignette-1',
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

  itIfNativeCore('runs deterministic native effect-pass pixel fixture probes', async () => {
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

      const sourceId = 'native-effect-pass-fixture-source';
      const layerId = 'native-effect-pass-fixture-layer';
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
            uri: 'native-effect-pass-fixture://source',
            source_type: 'image',
          },
        ],
      }, 5000);

      const sourceSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 0,
        frame_index: 1,
      }, 8000);
      assertVisibleSnapshot('effect fixture source layer', sourceSnapshot);
      const sourcePixels = snapshotPixels(sourceSnapshot);
      const chromaKeyRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.5, 0.5);
      const differenceKeyRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.45, 0.5);

      const fixtures = [
        {
          id: 'invert',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-invert',
            effect: 'invert',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 2,
            amount: 1,
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceLuma = snapshotPixelLuma(sourceSnapshot, sourcePixels, 0.08, 0.08);
            const effectLuma = snapshotPixelLuma(snapshot, pixels, 0.08, 0.08);
            expect(effectLuma).toBeGreaterThan(sourceLuma + 0.12);
          },
        },
        {
          id: 'pixelate',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-pixelate',
            effect: 'pixelate',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 3,
            amount: 28,
            params: {
              mode: 0,
              gridLines: 0,
              animSpeed: 0,
              animAmount: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const a = snapshotPixelRgb(snapshot, pixels, 0.505, 0.50);
            const b = snapshotPixelRgb(snapshot, pixels, 0.515, 0.50);
            const c = snapshotPixelRgb(snapshot, pixels, 0.80, 0.50);
            expect(rgbDistance(a, b)).toBeLessThan(0.05);
            expect(rgbDistance(a, c)).toBeGreaterThan(0.04);
          },
        },
        {
          id: 'vignette',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-vignette',
            effect: 'vignette',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 4,
            amount: 0.42,
            params: {
              softness: 0.12,
              roundness: 1,
              shape: 0,
              aspect: 1,
              centerX: 0.5,
              centerY: 0.5,
              tintAmount: 1,
              breathing: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const centerLuma = snapshotPixelLuma(snapshot, pixels, 0.5, 0.5);
            const cornerLuma = snapshotPixelLuma(snapshot, pixels, 0.04, 0.04);
            expect(centerLuma).toBeGreaterThan(cornerLuma + 0.08);
          },
        },
        {
          id: 'rgb-shift',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-rgb-shift',
            effect: 'rgb-shift',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 5,
            amount: 22,
            params: {
              angle: 0,
              mode: 0,
              centerX: 0.5,
              centerY: 0.5,
              prismSpread: 1.5,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.5, 0.5);
            const shiftedRgb = snapshotPixelRgb(snapshot, pixels, 0.5, 0.5);
            expect(rgbDistance(sourceRgb, shiftedRgb)).toBeGreaterThan(0.02);
          },
        },
        {
          id: 'scanlines',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-scanlines',
            effect: 'scanlines',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 6,
            amount: 0.8,
            params: {
              count: 36,
              speed: 0,
              phosphor: 0.35,
              rollingBar: 0,
              curvature: 0,
              interlace: 0.6,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const lineA = snapshotPixelLuma(snapshot, pixels, 0.5, 0.48);
            const lineB = snapshotPixelLuma(snapshot, pixels, 0.5, 0.52);
            expect(Math.abs(lineA - lineB)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'blur',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-blur',
            effect: 'blur',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 7,
            amount: 18,
            params: {
              mode: 1,
              angle: 0,
              param2: 1,
              edgeProtect: 0,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.76, 0.42);
            const blurredRgb = snapshotPixelRgb(snapshot, pixels, 0.76, 0.42);
            expect(rgbDistance(sourceRgb, blurredRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'chromatic-aberration',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-chromatic-aberration',
            effect: 'chromatic-aberration',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 8,
            amount: 1.2,
            params: {
              mode: 1,
              angle: 0,
              centerX: 0.5,
              centerY: 0.5,
              edgeFalloff: 0.4,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.78, 0.5);
            const shiftedRgb = snapshotPixelRgb(snapshot, pixels, 0.78, 0.5);
            expect(rgbDistance(sourceRgb, shiftedRgb)).toBeGreaterThan(0.015);
          },
        },
        {
          id: 'glitch',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-glitch',
            effect: 'glitch',
            width: 160,
            height: 90,
            time: 1.1,
            frameDelta: 1 / 30,
            frameIndex: 9,
            amount: 1,
            params: {
              speed: 1.5,
              blockSize: 0.1,
              rgbSplit: 1,
              jitter: 1,
              verticalSlice: 1,
              blockHold: 0,
              tearChance: 1,
              triggerMode: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.35, 0.62);
            const glitchedRgb = snapshotPixelRgb(snapshot, pixels, 0.35, 0.62);
            expect(rgbDistance(sourceRgb, glitchedRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'sharpen',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-sharpen',
            effect: 'sharpen',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 10,
            amount: 1.4,
            params: {
              mode: 0,
              radius: 2,
              edgeProtect: 0,
              intensity: 0.6,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.52, 0.55);
            const sharpenedRgb = snapshotPixelRgb(snapshot, pixels, 0.52, 0.55);
            expect(rgbDistance(sourceRgb, sharpenedRgb)).toBeGreaterThan(0.008);
          },
        },
        {
          id: 'directional-blur',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-directional-blur',
            effect: 'directional-blur',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 11,
            amount: 0.85,
            params: {
              angle: 0,
              samples: 24,
              falloff: 0,
              centerBias: 0,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.70, 0.48);
            const blurredRgb = snapshotPixelRgb(snapshot, pixels, 0.70, 0.48);
            expect(rgbDistance(sourceRgb, blurredRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'zoom-blur',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-zoom-blur',
            effect: 'zoom-blur',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 12,
            amount: 0.75,
            params: {
              centerX: 0.5,
              centerY: 0.5,
              samples: 24,
              falloff: 0.1,
              chromatic: 0.4,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.78, 0.5);
            const blurredRgb = snapshotPixelRgb(snapshot, pixels, 0.78, 0.5);
            expect(rgbDistance(sourceRgb, blurredRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'radial-blur',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-radial-blur',
            effect: 'radial-blur',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 13,
            amount: 0.9,
            params: {
              centerX: 0.5,
              centerY: 0.5,
              samples: 24,
              falloff: 0.1,
              radiusInner: 0,
              radiusOuter: 1,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.78, 0.5);
            const blurredRgb = snapshotPixelRgb(snapshot, pixels, 0.78, 0.5);
            expect(rgbDistance(sourceRgb, blurredRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'kaleidoscope',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-kaleidoscope',
            effect: 'kaleidoscope',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 14,
            amount: 1,
            params: {
              segments: 8,
              angle: 30,
              centerX: 0.5,
              centerY: 0.5,
              zoom: 1,
              mode: 0,
              spiral: 0.4,
              animSpeed: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const left = snapshotPixelRgb(snapshot, pixels, 0.22, 0.45);
            const right = snapshotPixelRgb(snapshot, pixels, 0.78, 0.45);
            expect(rgbDistance(left, right)).toBeLessThan(0.42);
          },
        },
        {
          id: 'mirror',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-mirror',
            effect: 'mirror',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 15,
            amount: 1,
            params: {
              mode: 0,
              position: 0.5,
              offset: 0.5,
              flipSide: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const left = snapshotPixelRgb(snapshot, pixels, 0.25, 0.52);
            const right = snapshotPixelRgb(snapshot, pixels, 0.75, 0.52);
            expect(rgbDistance(left, right)).toBeLessThan(0.08);
          },
        },
        {
          id: 'chroma-key',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-chroma-key',
            effect: 'chroma-key',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 16,
            amount: 1,
            params: {
              keyR: chromaKeyRgb[0],
              keyG: chromaKeyRgb[1],
              keyB: chromaKeyRgb[2],
              softness: 0.08,
              spill: 0,
              matte: 1,
              mode: 2,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceLuma = snapshotPixelLuma(sourceSnapshot, sourcePixels, 0.5, 0.5);
            const keyedLuma = snapshotPixelLuma(snapshot, pixels, 0.5, 0.5);
            expect(keyedLuma).toBeLessThan(sourceLuma - 0.08);
          },
        },
        {
          id: 'luma-key',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-luma-key',
            effect: 'luma-key',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 17,
            amount: 0.45,
            params: {
              highCut: 0.7,
              invert: 0,
              gamma: 1,
              matte: 0,
              premultiply: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceLuma = snapshotPixelLuma(sourceSnapshot, sourcePixels, 0.12, 0.12);
            const keyedLuma = snapshotPixelLuma(snapshot, pixels, 0.12, 0.12);
            expect(keyedLuma).toBeLessThan(sourceLuma - 0.04);
          },
        },
        {
          id: 'difference-key',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-difference-key',
            effect: 'difference-key',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 18,
            amount: 1,
            params: {
              refR: differenceKeyRgb[0],
              refG: differenceKeyRgb[1],
              refB: differenceKeyRgb[2],
              softness: 0.04,
              invert: 0,
              matte: 0,
              mode: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceLuma = snapshotPixelLuma(sourceSnapshot, sourcePixels, 0.45, 0.5);
            const keyedLuma = snapshotPixelLuma(snapshot, pixels, 0.45, 0.5);
            expect(keyedLuma).toBeLessThan(sourceLuma - 0.06);
          },
        },
        {
          id: 'erode',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-erode',
            effect: 'erode',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 19,
            amount: 5,
            params: {
              shape: 1,
              channel: 0,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.78, 0.5);
            const erodedRgb = snapshotPixelRgb(snapshot, pixels, 0.78, 0.5);
            expect(rgbDistance(sourceRgb, erodedRgb)).toBeGreaterThan(0.006);
          },
        },
        {
          id: 'dilate',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-dilate',
            effect: 'dilate',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 20,
            amount: 5,
            params: {
              shape: 1,
              channel: 0,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.22, 0.5);
            const dilatedRgb = snapshotPixelRgb(snapshot, pixels, 0.22, 0.5);
            expect(rgbDistance(sourceRgb, dilatedRgb)).toBeGreaterThan(0.006);
          },
        },
        {
          id: 'wave',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-wave',
            effect: 'wave',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 21,
            amount: 36,
            params: {
              mode: 0,
              waveform: 0,
              frequency: 4,
              speed: 0,
              phase: 45,
              secondary: 0.4,
              chromaSplit: 0.4,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.62, 0.55);
            const wavedRgb = snapshotPixelRgb(snapshot, pixels, 0.62, 0.55);
            expect(rgbDistance(sourceRgb, wavedRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'fisheye',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-fisheye',
            effect: 'fisheye',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 22,
            amount: 0.9,
            params: {
              radius: 1,
              centerX: 0.5,
              centerY: 0.5,
              zoom: 1,
              mode: 1,
              edgeFalloff: 0.6,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.78, 0.55);
            const fishRgb = snapshotPixelRgb(snapshot, pixels, 0.78, 0.55);
            expect(rgbDistance(sourceRgb, fishRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'lens-distortion',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-lens-distortion',
            effect: 'lens-distortion',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 23,
            amount: 0.85,
            params: {
              mode: 3,
              centerX: 0.5,
              centerY: 0.5,
              cubic: 0.25,
              anamorphicX: 1.5,
              edgeFade: 1,
              chromatic: 0.4,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.76, 0.58);
            const lensRgb = snapshotPixelRgb(snapshot, pixels, 0.76, 0.58);
            expect(rgbDistance(sourceRgb, lensRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'twirl',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-twirl',
            effect: 'twirl',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 24,
            amount: 3.5,
            params: {
              radius: 0.95,
              centerX: 0.5,
              centerY: 0.5,
              falloff: 1.1,
              animSpeed: 0,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.68, 0.58);
            const twirlRgb = snapshotPixelRgb(snapshot, pixels, 0.68, 0.58);
            expect(rgbDistance(sourceRgb, twirlRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'pinch-bulge',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-pinch-bulge',
            effect: 'pinch-bulge',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 25,
            amount: 0.9,
            params: {
              radius: 0.85,
              centerX: 0.5,
              centerY: 0.5,
              falloff: 1.2,
              chromatic: 0.4,
              outputMix: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.72, 0.52);
            const pinchRgb = snapshotPixelRgb(snapshot, pixels, 0.72, 0.52);
            expect(rgbDistance(sourceRgb, pinchRgb)).toBeGreaterThan(0.012);
          },
        },
        {
          id: 'edge-detect',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-edge-detect',
            effect: 'edge-detect',
            width: 160,
            height: 90,
            time: 0.2,
            frameDelta: 1 / 30,
            frameIndex: 26,
            amount: 0.03,
            params: {
              thickness: 2,
              mode: 1,
              invert: 0,
              edgeTintR: 0,
              edgeTintG: 1,
              edgeTintB: 1,
              tintEdges: 1,
              edgeGlow: 0.75,
              edgeOnlyAlpha: 0,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.52, 0.55);
            const edgeRgb = snapshotPixelRgb(snapshot, pixels, 0.52, 0.55);
            expect(rgbDistance(sourceRgb, edgeRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'film-grain',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-film-grain',
            effect: 'film-grain',
            width: 160,
            height: 90,
            time: 0.4,
            frameDelta: 1 / 30,
            frameIndex: 30,
            amount: 0.85,
            params: {
              grainSize: 1.1,
              grainShadow: 1.2,
              grainMid: 1,
              grainHigh: 0.8,
              grainMono: 0,
              grainStock: 3,
              grainColorJitter: 0.7,
              grainAnimSpeed: 1,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.43, 0.47);
            const grainRgb = snapshotPixelRgb(snapshot, pixels, 0.43, 0.47);
            expect(rgbDistance(sourceRgb, grainRgb)).toBeGreaterThan(0.008);
          },
        },
        {
          id: 'filmic-tonemap',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-filmic-tonemap',
            effect: 'filmic-tonemap',
            width: 160,
            height: 90,
            time: 0.1,
            frameDelta: 1 / 30,
            frameIndex: 31,
            amount: 1,
            params: {
              tonemapCurve: 2,
              tonemapExposure: 1.8,
              tonemapContrast: 0.55,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.68, 0.38);
            const toneRgb = snapshotPixelRgb(snapshot, pixels, 0.68, 0.38);
            expect(rgbDistance(sourceRgb, toneRgb)).toBeGreaterThan(0.01);
          },
        },
        {
          id: 'bloom',
          graph: buildNativeEffectPassGraph({
            sourceId,
            targetSourceId: 'native-effect-pass-fixture-bloom',
            effect: 'bloom',
            width: 160,
            height: 90,
            time: 0.1,
            frameDelta: 1 / 30,
            frameIndex: 32,
            amount: 0.9,
            params: {
              bloomIntensity: 1.7,
              threshold: 0.24,
              bloomKnee: 0.65,
              bloomRadius: 0.85,
              bloomAnamorphic: 0.35,
              red: 1,
              green: 0.9,
              blue: 0.75,
            },
          }),
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const sourceRgb = snapshotPixelRgb(sourceSnapshot, sourcePixels, 0.58, 0.42);
            const bloomRgb = snapshotPixelRgb(snapshot, pixels, 0.58, 0.42);
            expect(rgbDistance(sourceRgb, bloomRgb)).toBeGreaterThan(0.01);
          },
        },
      ];

      for (const [fixtureIndex, fixture] of fixtures.entries()) {
        await rpc.send('submit_commands', {
          commands: [
            {
              type: 'upload_source_frame',
              source_id: sourceId,
              width: 32,
              height: 32,
              rgba_b64: Buffer.from(sourceBytes).toString('base64'),
              seq: 100 + fixtureIndex,
            },
          ],
        }, 5000);
        const graphResult = await rpc.send('compute_graph', fixture.graph.config, 8000);
        expect(graphResult?.render).toMatchObject({
          target: 'source_frame',
          source_id: `native-effect-pass-fixture-${fixture.id}`,
        });
        await rpc.send('submit_commands', {
          commands: [
            {
              type: 'bind_media_source',
              layer_id: layerId,
              source_id: `native-effect-pass-fixture-${fixture.id}`,
              uri: `native-effect-pass-fixture://${fixture.id}`,
              source_type: 'image',
            },
          ],
        }, 5000);
        const snapshot = await rpc.send('frame_snapshot', {
          include_pixels: true,
          time: 0.2,
          frame_index: 10,
        }, 8000);
        assertVisibleSnapshot(`effect fixture ${fixture.id}`, snapshot);
        expect(snapshot.checksum).not.toBe(sourceSnapshot.checksum);
        fixture.assert(snapshot, snapshotPixels(snapshot));
      }
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
          {
            effect: 'vignette',
            amount: 0.72,
            params: {
              softness: 0.22,
              roundness: 0.9,
              shape: 3,
              aspect: 1.25,
              centerX: 0.45,
              centerY: 0.58,
              tintAmount: 0.2,
              breathing: 0,
            },
          },
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
        include_pixels: true,
        time: 0.4,
        frame_index: 4,
      }, 8000);
      assertVisibleSnapshot('effect pass chain output layer', effectSnapshot);
      expect(effectSnapshot.checksum).not.toBe(sourceSnapshot.checksum);
      const pixels = snapshotPixels(effectSnapshot);
      const centerLuma = snapshotPixelLuma(effectSnapshot, pixels, 0.5, 0.5);
      const cornerLuma = snapshotPixelLuma(effectSnapshot, pixels, 0.04, 0.04);
      expect(centerLuma).toBeGreaterThan(cornerLuma + 0.04);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
