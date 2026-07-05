import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSmoke3DNativeComputeGraph,
  buildSmoke3DNativePrecompileCommands,
} from './webgpu3DSmoke';
import {
  buildFlythroughNativeComputeGraph,
  buildFlythroughNativePrecompileCommands,
} from './webgpuFlythrough';
import {
  buildInkCloudNativeComputeGraph,
  buildInkCloudNativePrecompileCommands,
} from './webgpuInkCloud';
import {
  buildParticleFieldNativeComputeGraph,
  buildParticleFieldNativePrecompileCommands,
} from './webgpuParticleField';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
} from './webgpuPixelParticles';
import {
  buildPointCloudFXNativeComputeGraph,
  buildPointCloudFXNativePointData,
  buildPointCloudFXNativePrecompileCommands,
} from './webgpuPointCloudFX';
import {
  buildPlanetNativeComputeGraph,
  buildPlanetNativePrecompileCommands,
} from './shaders/webgpuPlanet';
import {
  buildSmokeRidersNativeComputeGraph,
} from './shaders/webgpuSmokeRidersShader';
import {
  buildVolumetricSpheresNativeComputeGraph,
  buildVolumetricSpheresNativePrecompileCommands,
} from './shaders/webgpuVolumetricSpheresShader';

if (typeof globalThis.btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    Buffer.from(value, 'binary').toString('base64');
}

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const SOURCE_FRAME_PROBE_SHADER_ID = 'native-graph/source-frame-probe';

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
      bytes[offset] = Math.round(24 + (x / Math.max(1, width - 1)) * 180);
      bytes[offset + 1] = Math.round(12 + (y / Math.max(1, height - 1)) * 210);
      bytes[offset + 2] = Math.round(32 + (((x * 3 + y * 5) % 17) / 16) * 170);
      bytes[offset + 3] = 255;
    }
  }
  return bytes;
}

function makePointCloudFixture(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const ring = t * Math.PI * 8;
    positions[i * 3 + 0] = Math.cos(ring) * (0.15 + t * 1.1);
    positions[i * 3 + 1] = Math.sin(t * Math.PI * 5) * 0.8;
    positions[i * 3 + 2] = Math.sin(ring) * (0.2 + t * 1.2);
    colors[i * 3 + 0] = 0.2 + t * 0.8;
    colors[i * 3 + 1] = 1 - t * 0.7;
    colors[i * 3 + 2] = 0.35 + Math.sin(ring) * 0.25;
  }
  return buildPointCloudFXNativePointData(positions, colors, {
    maxPoints: Math.min(count, 96),
    pointSize: 0.018,
    signature: `runtime-fixture-${count}`,
  });
}

function makeGaussianPointCloudFixture(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const splatScale = new Float32Array(count * 3);
  const splatRotation = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const ring = t * Math.PI * 10;
    positions[i * 3 + 0] = Math.cos(ring) * (0.18 + t * 0.85);
    positions[i * 3 + 1] = Math.sin(ring * 0.45) * 0.55;
    positions[i * 3 + 2] = Math.sin(ring) * (0.24 + t * 0.65);
    colors[i * 3 + 0] = 0.25 + t * 0.75;
    colors[i * 3 + 1] = 0.35 + Math.sin(ring) * 0.22;
    colors[i * 3 + 2] = 0.9 - t * 0.35;
    alpha[i] = 0.45 + (i % 5) * 0.1;
    splatScale[i * 3 + 0] = -3.9 + Math.sin(ring) * 0.15;
    splatScale[i * 3 + 1] = -4.5 + Math.cos(ring * 0.7) * 0.12;
    splatScale[i * 3 + 2] = -5.2;
    splatRotation[i * 4 + 0] = Math.cos(ring * 0.125);
    splatRotation[i * 4 + 1] = 0;
    splatRotation[i * 4 + 2] = Math.sin(ring * 0.125);
    splatRotation[i * 4 + 3] = 0;
  }
  return buildPointCloudFXNativePointData(positions, colors, {
    maxPoints: Math.min(count, 96),
    pointSize: 0.024,
    alpha,
    splatScale,
    splatRotation,
    gaussian: true,
    signature: `runtime-gaussian-fixture-${count}`,
  });
}

function initialBufferToBase64(value: unknown): string | null {
  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value)).toString('base64');
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).toString('base64');
  }
  return null;
}

function encodeNativeGraphConfigForRpc(config: Record<string, any>): Record<string, any> {
  return {
    ...config,
    buffers: Array.isArray(config.buffers)
      ? config.buffers.map((buffer: Record<string, any>) => {
          const initial_b64 = buffer.initial_b64 ?? initialBufferToBase64(buffer.initial_buffer);
          if (!initial_b64 && buffer.initial_buffer == null) return buffer;
          const { initial_buffer, ...rest } = buffer;
          return initial_b64 ? { ...rest, initial_b64 } : rest;
        })
      : [],
  };
}

function assertVisibleSnapshot(label: string, snapshot: Record<string, unknown>, minLuma = 0.015) {
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

function sourceFrameProbeWgsl() {
  return String.raw`
struct ProbeUniforms {
  width: u32,
  height: u32,
  pixel_count: u32,
  _pad0: u32,
}

@group(0) @binding(0)
var<storage, read_write> output_words: array<u32>;

@group(0) @binding(1)
var<uniform> probe: ProbeUniforms;

@group(0) @binding(2)
var source_tex: texture_2d<f32>;

@group(0) @binding(3)
var source_sampler: sampler;

fn pixel_coord(i: u32) -> vec2<f32> {
  let safe_width = max(probe.width, 1u);
  let safe_height = max(probe.height, 1u);
  let x = f32(i % safe_width);
  let y = f32(i / safe_width);
  return (vec2<f32>(x, y) + vec2<f32>(0.5)) / vec2<f32>(f32(safe_width), f32(safe_height));
}

fn pack_channel(value: f32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * 255.0));
}

fn pack_rgba(color: vec4<f32>) -> u32 {
  let r = pack_channel(color.r);
  let g = pack_channel(color.g);
  let b = pack_channel(color.b);
  let a = pack_channel(color.a);
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

@compute @workgroup_size(64)
fn cs_probe(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= probe.pixel_count) { return; }
  let color = textureSampleLevel(source_tex, source_sampler, pixel_coord(i), 0.0);
  output_words[i] = pack_rgba(color);
}
`;
}

async function readSourceFrameProbe(
  rpc: NativeRpc,
  sourceId: string,
  label: string,
  width: number,
  height: number,
) {
  const pixelCount = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height));
  const outputId = `native-graph-probe:${label}:output`;
  const uniformId = `native-graph-probe:${label}:uniform`;
  const result = await rpc.send('compute_graph', {
    buffers: [
      {
        id: outputId,
        kind: 'storage',
        byte_length: pixelCount * 4,
      },
      {
        id: uniformId,
        kind: 'uniform',
        byte_length: 16,
        initial_u32: [Math.round(width), Math.round(height), pixelCount, 0],
      },
    ],
    passes: [{
      name: `native-graph-probe-${label}`,
      shader_id: SOURCE_FRAME_PROBE_SHADER_ID,
      entry: 'cs_probe',
      dispatch: [Math.ceil(pixelCount / 64), 1, 1],
      bindings: [
        { binding: 0, resource: outputId, kind: 'storage' },
        { binding: 1, resource: uniformId, kind: 'uniform' },
        { binding: 2, kind: 'source-frame-texture', source_id: sourceId },
        { binding: 3, kind: 'source-frame-sampler' },
      ],
    }],
    readbacks: [{ id: outputId, include_bytes: true }],
  }, 10000);
  const readback = result?.readbacks?.[outputId] as Record<string, unknown> | undefined;
  if (!readback) {
    throw new Error(`native graph source-frame probe ${label} omitted readback ${outputId}`);
  }
  expect(String(readback?.checksum ?? ''), label).toHaveLength(16);
  expect(Number(readback?.nonzero_words ?? 0), label).toBeGreaterThan(0);
  const bytes = typeof readback?.bytes_b64 === 'string'
    ? Buffer.from(readback.bytes_b64, 'base64')
    : null;
  expect(bytes?.byteLength ?? 0, label).toBe(pixelCount * 4);
  return readback;
}

describe('Native graph instrument runtime fixtures', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

  itIfNativeCore('uses explicit graph clock for native source-frame renders', async () => {
    const rpc = createNativeRpc();
    const sourceId = 'native-graph-clock-source';
    const renderClockPlanet = async (time: number, frameIndex: number) => {
      const graph = buildPlanetNativeComputeGraph({
        sourceId,
        params: {
          planet: 'earth',
          rotationSpeed: 23,
          cloudSpeed: 4.5,
          cloudCoverage: 0.95,
          auroraStrength: 2.5,
          cameraDistance: 3.1,
        },
        width: 128,
        height: 72,
        time,
        frameDelta: 1 / 30,
        frameIndex,
        reset: true,
      });
      const graphResult = await rpc.send(
        'compute_graph',
        encodeNativeGraphConfigForRpc(graph.config),
        12000,
      );
      const renders = Array.isArray(graphResult?.renders)
        ? graphResult.renders
        : graphResult?.render
          ? [graphResult.render]
          : [];
      expect(renders.some((render: Record<string, unknown>) => (
        render.target === 'source_frame' &&
        render.source_id === sourceId
      )), sourceId).toBe(true);
      return readSourceFrameProbe(rpc, sourceId, `planet-${frameIndex}`, 128, 72);
    };

    try {
      await rpc.send('start', {
        config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: 128,
          height: 72,
          target_fps: 30,
          native_quality_policy: 'performance',
        },
      }, 12000);
      await delay(80);

      const capabilities = await rpc.send('capabilities', {}, 5000);
      expect(capabilities?.features?.compute_graph_render).toBe(true);
      expect(capabilities?.features?.compute_graph_source_frame_target).toBe(true);

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          ...buildPlanetNativePrecompileCommands(),
          {
            type: 'precompile_shader',
            shader_id: SOURCE_FRAME_PROBE_SHADER_ID,
            stage: 'compute',
            entry: 'cs_probe',
            source: sourceFrameProbeWgsl(),
          },
        ],
      }, 8000);
      expect(Number(precompileSummary?.dropped ?? 0)).toBe(0);

      const first = await renderClockPlanet(2.25, 68);
      await delay(180);
      const repeated = await renderClockPlanet(2.25, 69);
      const advanced = await renderClockPlanet(20.25, 608);

      expect(String(repeated.checksum)).toBe(String(first.checksum));
      expect(String(advanced.checksum)).not.toBe(String(first.checksum));
    } finally {
      await rpc.close();
    }
  }, 45000);

  itIfNativeCore('renders representative native graph instruments into source frames', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', {
        config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: 160,
          height: 90,
          target_fps: 30,
          native_quality_policy: 'performance',
        },
      }, 12000);
      await delay(80);

      const capabilities = await rpc.send('capabilities', {}, 5000);
      expect(capabilities?.features?.compute_graph_render).toBe(true);
      expect(capabilities?.features?.compute_graph_source_frame_target).toBe(true);
      expect(capabilities?.features?.multi_pass_instruments).toBe(true);
      expect(capabilities?.features?.native_instrument_proxies).toBe(false);
      expect(capabilities?.native_graph_instruments).toEqual(expect.arrayContaining([
        'planet',
        'smoke-3d',
        'particle-field',
        'pixel-particles',
        'volumetric-spheres',
        'smoke-riders',
        'ink-cloud',
        'flythrough',
        'point-cloud-fx',
      ]));

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          ...buildPlanetNativePrecompileCommands(),
          ...buildSmoke3DNativePrecompileCommands(),
          ...buildVolumetricSpheresNativePrecompileCommands(),
          ...buildParticleFieldNativePrecompileCommands(),
          ...buildPixelParticlesNativePrecompileCommands(),
          ...buildFlythroughNativePrecompileCommands(),
          ...buildInkCloudNativePrecompileCommands(),
          ...buildPointCloudFXNativePrecompileCommands(),
        ],
      }, 12000);
      expect(Number(precompileSummary?.dropped ?? 0)).toBe(0);

      const mediaSourceId = 'native-graph-fixture-media-source';
      await rpc.send('submit_commands', {
        commands: [{
          type: 'upload_source_frame',
          source_id: mediaSourceId,
          width: 32,
          height: 32,
          rgba_b64: Buffer.from(makeSourceBytes(32, 32)).toString('base64'),
          seq: 1,
        }],
      }, 5000);

      const fixtures = [
        {
          id: 'planet',
          graph: buildPlanetNativeComputeGraph({
            sourceId: 'native-graph-fixture-planet',
            params: {
              planet: 'saturn',
              rotationSpeed: 8,
              cloudSpeed: 0.5,
              cameraDistance: 3.1,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 2,
            reset: true,
          }),
          minLuma: 0.02,
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const center = snapshotPixelLuma(snapshot, pixels, 0.5, 0.5);
            const corner = snapshotPixelLuma(snapshot, pixels, 0.04, 0.04);
            expect(center).toBeGreaterThan(corner + 0.02);
          },
        },
        {
          id: 'volumetric-spheres',
          graph: buildVolumetricSpheresNativeComputeGraph({
            sourceId: 'native-graph-fixture-volumetric-spheres',
            params: {
              layout: 'orbital',
              sphereCount: 96,
              autoRotateY: 4,
              colorA: [80, 190, 255],
              colorB: [255, 70, 170],
              backgroundOpacity: 0.25,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 3,
            reset: true,
          }),
          minLuma: 0.01,
          assert(snapshot: Record<string, unknown>, pixels: Uint8Array) {
            const center = snapshotPixelLuma(snapshot, pixels, 0.5, 0.5);
            const side = snapshotPixelLuma(snapshot, pixels, 0.18, 0.5);
            expect(Math.max(center, side)).toBeGreaterThan(0.04);
          },
        },
        {
          id: 'smoke-3d',
          graph: buildSmoke3DNativeComputeGraph({
            sourceId: 'native-graph-fixture-smoke-3d',
            params: {
              gridSize: 24,
              emitterCount: 4,
              splatRate: 60,
              density: 1.4,
              brightness: 1.2,
              bass: 0.45,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 6,
            reset: true,
          }),
          minLuma: 0.004,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(40);
          },
        },
        {
          id: 'particle-field',
          graph: buildParticleFieldNativeComputeGraph({
            sourceId: 'native-graph-fixture-particle-field',
            params: {
              mode: 'gravity',
              topology: 'softSphere',
              particleCount: 2048,
              connectEnabled: false,
              fogOpacity: 0.7,
              bass: 0.45,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 4,
            reset: true,
          }),
          minLuma: 0.006,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(80);
          },
        },
        {
          id: 'pixel-particles',
          graph: buildPixelParticlesNativeComputeGraph({
            sourceId: 'native-graph-fixture-pixel-particles',
            mediaSourceId,
            params: {
              mode: 'depth-shift',
              particleCount: 2048,
              depthAmount: 0.75,
              depthMotion: 'drift',
              mirrorX: true,
            },
            width: 160,
            height: 90,
            sourceFrameSize: 1024,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 5,
            reset: true,
          }),
          minLuma: 0.003,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(50);
          },
        },
        {
          id: 'smoke-riders',
          graph: buildSmokeRidersNativeComputeGraph({
            sourceId: 'native-graph-fixture-smoke-riders',
            params: {
              quality: 'performance',
              style: 'orbital',
              sphereCount: 72,
              smokeDensity: 1.7,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 7,
            audioBass: 0.4,
            audioTreble: 0.25,
            reset: true,
          }),
          minLuma: 0.006,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(80);
          },
        },
        {
          id: 'ink-cloud',
          graph: buildInkCloudNativeComputeGraph({
            sourceId: 'native-graph-fixture-ink-cloud',
            params: {
              particleCount: 4096,
              emitterCount: 4,
              spread: 0.7,
              bgOpacity: 0.5,
              density: 1.2,
              emitterColor1: [255, 90, 35],
              emitterColor2: [40, 210, 255],
              autoRotateY: 10,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 8,
            audioBass: 0.8,
            audioTreble: 0.35,
            reset: true,
          }),
          minLuma: 0.004,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(60);
          },
        },
        {
          id: 'flythrough',
          graph: buildFlythroughNativeComputeGraph({
            sourceId: 'native-graph-fixture-flythrough',
            mediaSourceId,
            params: {
              topology: 'strokes',
              particleCount: 2048,
              slabCount: 3,
              flySpeed: 1.3,
              audioReactive: true,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 9,
            audioBass: 0.55,
            reset: true,
          }),
          minLuma: 0.003,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(40);
          },
        },
        {
          id: 'point-cloud-fx',
          graph: buildPointCloudFXNativeComputeGraph({
            sourceId: 'native-graph-fixture-point-cloud-fx',
            pointData: makePointCloudFixture(128),
            params: {
              topology: 'strokes',
              pointSize: 0.018,
              strokeLength: 0.06,
              colorMode: 'palette4',
              colorA: [60, 140, 255],
              colorB: [255, 70, 190],
              filterMode: 'none',
              audioReactive: true,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 10,
            audioBass: 0.45,
            audioTreble: 0.25,
            reset: true,
          }),
          minLuma: 0.002,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(20);
          },
        },
        {
          id: 'point-cloud-fx-gaussian',
          graph: buildPointCloudFXNativeComputeGraph({
            sourceId: 'native-graph-fixture-point-cloud-fx-gaussian',
            pointData: makeGaussianPointCloudFixture(96),
            params: {
              topology: 'billboards',
              pointSize: 0.024,
              opacity: 0.9,
              brightness: 1.35,
              colorMode: 'source',
              filterMode: 'none',
              autoRotateY: 0,
              audioReactive: false,
            },
            width: 160,
            height: 90,
            time: 1,
            frameDelta: 1 / 30,
            frameIndex: 11,
            reset: true,
          }),
          minLuma: 0.002,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(20);
          },
        },
      ];

      const checksums = new Set<string>();
      for (const fixture of fixtures) {
        const graphResult = await rpc.send(
          'compute_graph',
          encodeNativeGraphConfigForRpc(fixture.graph.config),
          20000,
        );
        const renders = Array.isArray(graphResult?.renders)
          ? graphResult.renders
          : graphResult?.render
            ? [graphResult.render]
            : [];
        expect(renders.length, fixture.id).toBeGreaterThan(0);
        expect(renders.some((render: Record<string, unknown>) => (
          render.target === 'source_frame' &&
          render.source_id === `native-graph-fixture-${fixture.id}`
        )), fixture.id).toBe(true);

        await rpc.send('submit_commands', {
          commands: [
            {
              type: 'upsert_layer',
              layer_id: `native-graph-fixture-layer-${fixture.id}`,
              z_index: 0,
              blend_mode: 'normal',
              opacity: 1,
              corners: FULLSCREEN_CORNERS,
            },
            { type: 'set_layer_visibility', layer_id: `native-graph-fixture-layer-${fixture.id}`, visible: true },
            {
              type: 'bind_media_source',
              layer_id: `native-graph-fixture-layer-${fixture.id}`,
              source_id: `native-graph-fixture-${fixture.id}`,
              uri: `native-graph-fixture://${fixture.id}`,
              source_type: 'image',
            },
          ],
        }, 5000);
        const snapshot = await rpc.send('frame_snapshot', {
          include_pixels: true,
          time: 1,
          frame_index: 10,
        }, 8000);
        assertVisibleSnapshot(`native graph fixture ${fixture.id}`, snapshot, fixture.minLuma);
        expect(checksums.has(String(snapshot.checksum)), fixture.id).toBe(false);
        checksums.add(String(snapshot.checksum));
        fixture.assert(snapshot, snapshotPixels(snapshot));

        await rpc.send('submit_commands', {
          commands: [{
            type: 'remove_layer',
            layer_id: `native-graph-fixture-layer-${fixture.id}`,
          }],
        }, 5000);
      }
    } finally {
      await rpc.close();
    }
  }, 90000);
});
