import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNativePluginPrecompileCommands } from './nativePluginGraphs';
import { buildVJCrossfadePrecompileCommands } from './vjCrossfadeNative';
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
import { buildLinesNativePrecompileCommands } from './linesNative';
import { buildLightPaintingNativePrecompileCommands } from './lightPaintingNative';
import { buildTextNativePrecompileCommands } from './textNative';
import { buildSplatNativePrecompileCommands } from './splatNative';
import { buildModel3DNativePrecompileCommands } from './model3dNative';
import { buildSvgNativePrecompileCommands } from './svgNative';
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
const NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID = 'native-graph/feature-contract';
const QUEUED_GRAPH_COMPUTE_SHADER_ID = 'native-graph/queued-live-compute';
const QUEUED_GRAPH_RENDER_SHADER_ID = 'native-graph/queued-live-render';

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

type NativeGraphManifestExpectation = {
  id: string;
  feature: string;
  shaderIds: string[];
};

function shaderIdsFromPrecompileCommands(commands: Array<{ shader_id: string }>): string[] {
  return Array.from(new Set(commands.map((command) => String(command.shader_id))));
}

function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(values).map(String).sort((a, b) => a.localeCompare(b));
}

const EXPECTED_NATIVE_GRAPH_MANIFEST: NativeGraphManifestExpectation[] = [
  {
    id: 'svg',
    feature: 'native_svg_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildSvgNativePrecompileCommands()),
  },
  {
    id: 'lines',
    feature: 'native_lines_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildLinesNativePrecompileCommands()),
  },
  {
    id: 'light-painting',
    feature: 'native_light_painting_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildLightPaintingNativePrecompileCommands()),
  },
  {
    id: 'text',
    feature: 'native_text_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildTextNativePrecompileCommands()),
  },
  {
    id: 'splat',
    feature: 'native_splat_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildSplatNativePrecompileCommands()),
  },
  {
    id: 'model3d',
    feature: 'native_model3d_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildModel3DNativePrecompileCommands()),
  },
  {
    id: 'planet',
    feature: 'native_planet_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildPlanetNativePrecompileCommands()),
  },
  {
    id: 'smoke-3d',
    feature: 'native_3d_smoke_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildSmoke3DNativePrecompileCommands()),
  },
  {
    id: 'particle-field',
    feature: 'native_particle_field_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildParticleFieldNativePrecompileCommands()),
  },
  {
    id: 'volumetric-spheres',
    feature: 'native_volumetric_spheres_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildVolumetricSpheresNativePrecompileCommands()),
  },
  {
    id: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    shaderIds: shaderIdsFromPrecompileCommands([
      ...buildSmoke3DNativePrecompileCommands(),
      ...buildVolumetricSpheresNativePrecompileCommands(),
    ]),
  },
  {
    id: 'ink-cloud',
    feature: 'native_ink_cloud_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildInkCloudNativePrecompileCommands()),
  },
  {
    id: 'flythrough',
    feature: 'native_flythrough_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildFlythroughNativePrecompileCommands()),
  },
  {
    id: 'pixel-particles',
    feature: 'native_pixel_particles_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildPixelParticlesNativePrecompileCommands()),
  },
  {
    id: 'point-cloud-fx',
    feature: 'native_point_cloud_fx_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildPointCloudFXNativePrecompileCommands()),
  },
  {
    id: 'ghostfx',
    feature: 'native_ghostfx_graph',
    shaderIds: shaderIdsFromPrecompileCommands(
      buildNativePluginPrecompileCommands().filter((command) =>
        String(command.shader_id).startsWith('ghostfx/')),
    ),
  },
  {
    id: 'handfx',
    feature: 'native_handfx_graph',
    shaderIds: shaderIdsFromPrecompileCommands(
      buildNativePluginPrecompileCommands().filter((command) =>
        String(command.shader_id).startsWith('handfx/')),
    ),
  },
  {
    id: 'vj-crossfade',
    feature: 'native_vj_crossfade_graph',
    shaderIds: shaderIdsFromPrecompileCommands(buildVJCrossfadePrecompileCommands()),
  },
  {
    id: 'performer-world',
    feature: 'native_performer_world_graph',
    shaderIds: shaderIdsFromPrecompileCommands(
      buildNativePluginPrecompileCommands().filter((command) =>
        String(command.shader_id).startsWith('performer-world/')),
    ),
  },
];

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

function makeTintedSourceBytes(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const stripe = ((x + y) % 7) / 6;
      const vignette = 0.75 + 0.25 * (1 - Math.abs((x / Math.max(1, width - 1)) * 2 - 1));
      bytes[offset] = Math.round(Math.min(255, rgb[0] * vignette + stripe * 18));
      bytes[offset + 1] = Math.round(Math.min(255, rgb[1] * vignette + (1 - stripe) * 14));
      bytes[offset + 2] = Math.round(Math.min(255, rgb[2] * vignette + stripe * 10));
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
    const ring = Math.floor(i / 48);
    const angle = t * Math.PI * 14;
    const radius = 0.18 + (ring % 5) * 0.09 + Math.sin(t * Math.PI * 8) * 0.04;
    positions[i * 3 + 0] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle * 1.7) * 0.38;
    positions[i * 3 + 2] = Math.sin(angle) * radius + (t - 0.5) * 0.35;
    colors[i * 3 + 0] = 0.25 + 0.75 * t;
    colors[i * 3 + 1] = 0.85 - 0.55 * t;
    colors[i * 3 + 2] = 0.55 + 0.35 * Math.sin(angle * 0.5);
  }
  return { positions, colors };
}

function makeGaussianPointCloudFixture(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const splatScale = new Float32Array(count * 3);
  const splatRotation = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const angle = t * Math.PI * 10;
    positions[i * 3 + 0] = Math.cos(angle) * (0.18 + t * 0.72);
    positions[i * 3 + 1] = Math.sin(angle * 0.55) * 0.42;
    positions[i * 3 + 2] = Math.sin(angle) * (0.22 + t * 0.58);
    colors[i * 3 + 0] = 0.25 + t * 0.75;
    colors[i * 3 + 1] = 0.35 + Math.sin(angle) * 0.22;
    colors[i * 3 + 2] = 0.9 - t * 0.35;
    alpha[i] = 0.5 + (i % 5) * 0.08;
    splatScale[i * 3 + 0] = -3.9 + Math.sin(angle) * 0.15;
    splatScale[i * 3 + 1] = -4.5 + Math.cos(angle * 0.7) * 0.12;
    splatScale[i * 3 + 2] = -5.2;
    splatRotation[i * 4 + 0] = Math.cos(angle * 0.125);
    splatRotation[i * 4 + 1] = 0;
    splatRotation[i * 4 + 2] = Math.sin(angle * 0.125);
    splatRotation[i * 4 + 3] = 0;
  }
  return buildPointCloudFXNativePointData(positions, colors, {
    maxPoints: Math.min(count, 256),
    pointSize: 0.026,
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

function nativeGraphFeatureContractWgsl() {
  return String.raw`
struct ContractUniforms {
  tint: vec4<f32>,
  params: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> u: ContractUniforms;

@group(0) @binding(1)
var source_tex: texture_2d<f32>;

@group(0) @binding(2)
var source_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
}

fn tri_vertex(index: u32) -> vec2<f32> {
  let verts = array<vec2<f32>, 3>(
    vec2<f32>(-0.72, -0.62),
    vec2<f32>( 0.72, -0.62),
    vec2<f32>( 0.00,  0.74),
  );
  return verts[index % 3u];
}

@vertex
fn vs_triangle(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let p = tri_vertex(vertex_index);
  var out: VertexOut;
  out.position = vec4<f32>(p + u.params.yz, clamp(u.params.x, 0.0, 1.0), 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  out.color = u.tint;
  return out;
}

@vertex
fn vs_line(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let verts = array<vec2<f32>, 2>(
    vec2<f32>(-0.84, -0.68),
    vec2<f32>( 0.84,  0.68),
  );
  let p = verts[vertex_index % 2u];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.04, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  out.color = u.tint;
  return out;
}

@fragment
fn fs_tint(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}

@fragment
fn fs_sample_add(in: VertexOut) -> @location(0) vec4<f32> {
  let sampled = textureSampleLevel(source_tex, source_sampler, clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  return vec4<f32>(min(sampled.rgb + in.color.rgb * 0.35, vec3<f32>(1.0)), 1.0);
}
`;
}

function queuedGraphComputeWgsl() {
  return String.raw`
@group(0) @binding(0)
var<storage, read_write> color_out: array<vec4<f32>>;

@compute @workgroup_size(1)
fn cs_seed() {
  color_out[0] = vec4<f32>(0.14, 0.82, 0.36, 1.0);
}
`;
}

function queuedGraphRenderWgsl() {
  return String.raw`
@group(0) @binding(0)
var<storage, read> color_in: array<vec4<f32>>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = pos[vertex_index % 3u];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_color(_in: VertexOut) -> @location(0) vec4<f32> {
  return color_in[0];
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

async function uploadTintedSourceFrame(
  rpc: NativeRpc,
  sourceId: string,
  rgb: [number, number, number],
  seq: number,
  width = 32,
  height = 32,
) {
  await rpc.send('submit_commands', {
    commands: [{
      type: 'upload_source_frame',
      source_id: sourceId,
      width,
      height,
      rgba_b64: Buffer.from(makeTintedSourceBytes(width, height, rgb)).toString('base64'),
      seq,
    }],
  }, 5000);
}

function meanRgbFromProbe(readback: Record<string, unknown>): [number, number, number] {
  const bytes = typeof readback.bytes_b64 === 'string'
    ? Buffer.from(readback.bytes_b64, 'base64')
    : typeof readback.rgba_b64 === 'string'
      ? Buffer.from(readback.rgba_b64, 'base64')
    : Buffer.alloc(0);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const alpha = bytes[i + 3];
    if (alpha <= 0) continue;
    r += Math.min(1, bytes[i] / alpha);
    g += Math.min(1, bytes[i + 1] / alpha);
    b += Math.min(1, bytes[i + 2] / alpha);
    count += 1;
  }
  if (!count) {
    for (let i = 0; i + 3 < bytes.length; i += 4) {
      r += bytes[i] / 255;
      g += bytes[i + 1] / 255;
      b += bytes[i + 2] / 255;
      count += 1;
    }
  }
  const denom = Math.max(1, count);
  return [r / denom, g / denom, b / denom];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function meanFlythroughDepthAnchor(readback: Record<string, unknown> | undefined): number {
  const bytes = typeof readback?.bytes_b64 === 'string'
    ? Buffer.from(readback.bytes_b64, 'base64')
    : Buffer.alloc(0);
  const strideFloats = 12;
  const particleCount = Math.floor(bytes.byteLength / (strideFloats * 4));
  if (particleCount <= 0) return 0;
  const view = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let sum = 0;
  for (let i = 0; i < particleCount; i += 1) {
    sum += view[i * strideFloats + 7];
  }
  return sum / particleCount;
}

async function snapshotSourceFrameLayer(
  rpc: NativeRpc,
  sourceId: string,
  layerId: string,
  label: string,
  frameIndex: number,
  minLuma: number | null = 0.001,
) {
  await rpc.send('submit_commands', {
    commands: [
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
        uri: `native-graph-reactivity://${label}`,
        source_type: 'image',
      },
    ],
  }, 5000);
  const snapshot = await rpc.send('frame_snapshot', {
    include_pixels: true,
    time: 1.5,
    frame_index: frameIndex,
  }, 8000);
  await rpc.send('submit_commands', {
    commands: [{ type: 'remove_layer', layer_id: layerId }],
  }, 5000);
  if (minLuma === null) {
    expect(String(snapshot.checksum ?? ''), label).toHaveLength(16);
  } else {
    assertVisibleSnapshot(label, snapshot, minLuma);
  }
  return snapshot;
}

describe('Native graph instrument runtime fixtures', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

  itIfNativeCore('keeps Pixel Particles and Flythrough core-owned and advancing while the UI is idle', async () => {
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
      const compiled = await rpc.send('submit_commands', {
        commands: [
          ...buildPixelParticlesNativePrecompileCommands(),
          ...buildFlythroughNativePrecompileCommands(),
          ...buildSmoke3DNativePrecompileCommands(),
          ...buildVolumetricSpheresNativePrecompileCommands(),
        ],
      }, 8000);
      expect(Number(compiled?.dropped ?? 0)).toBe(0);
      const inputSourceId = 'core-owned-media-input';
      await uploadTintedSourceFrame(rpc, inputSourceId, [52, 196, 244], 1, 48, 48);

      for (const fixture of [
        {
          kind: 'pixel-particles',
          params: {
            particleCount: 8192,
            mode: 'depth-shift',
            baseSize: 0.02,
            depthAmount: 0.8,
            depthMotion: 'drift',
            depthMotionAmount: 0.4,
            depthMotionSpeed: 1.2,
          },
        },
        {
          kind: 'flythrough',
          params: { particleCount: 4096, topology: 'strokes', baseSize: 0.018, strokeWidth: 0.014, flySpeed: 1.2 },
        },
      ]) {
        const layerId = `core-owned-${fixture.kind}`;
        const sourceId = `core-owned-${fixture.kind}-output`;
        await rpc.send('submit_commands', {
          commands: [
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
              type: 'set_native_graph_layer',
              layer_id: layerId,
              kind: fixture.kind,
              instrument_source_id: sourceId,
              composite_source_id: sourceId,
              input_source_id: inputSourceId,
              effect_graph: null,
              params: fixture.params,
            },
          ],
        }, 8000);
        await delay(350);
        const first = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
        assertVisibleSnapshot(`core-owned ${fixture.kind}`, first, 0.0002);
        await delay(250);
        const second = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
        assertVisibleSnapshot(`advancing core-owned ${fixture.kind}`, second, 0.0002);
        expect(second.checksum, fixture.kind).not.toBe(first.checksum);
        await rpc.send('submit_commands', {
          commands: [{ type: 'remove_layer', layer_id: layerId }],
        }, 5000);
      }

      const pointFixture = makePointCloudFixture(768);
      const pointData = buildPointCloudFXNativePointData(
        pointFixture.positions,
        pointFixture.colors,
        { maxPoints: 768, signature: 'core-owned-point-cloud-data', pointSize: 0.025 },
      );
      const pointLayerId = 'core-owned-point-cloud-fx';
      const pointSourceId = 'core-owned-point-cloud-fx-output';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upload_native_point_cloud',
            layer_id: pointLayerId,
            signature: pointData.signature,
            point_count: pointData.pointCount,
            sort_count: pointData.sortCount,
            depth_sort_enabled: pointData.depthSortEnabled,
            home_b64: Buffer.from(pointData.homeInitialBuffer).toString('base64'),
            live_b64: Buffer.from(pointData.liveInitialBuffer).toString('base64'),
            sort_b64: Buffer.from(pointData.sortInitialBuffer).toString('base64'),
          },
          {
            type: 'upsert_layer',
            layer_id: pointLayerId,
            z_index: 0,
            blend_mode: 'normal',
            opacity: 1,
            corners: FULLSCREEN_CORNERS,
          },
          { type: 'set_layer_visibility', layer_id: pointLayerId, visible: true },
          {
            type: 'set_native_graph_layer',
            layer_id: pointLayerId,
            kind: 'point-cloud-fx',
            instrument_source_id: pointSourceId,
            composite_source_id: pointSourceId,
            input_source_id: null,
            effect_graph: null,
            params: { pointSize: 0.025, autoRotateY: 24, windStrength: 0.12 },
          },
        ],
      }, 8000);
      await delay(350);
      const pointFirst = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      assertVisibleSnapshot('core-owned point-cloud-fx', pointFirst, 0.0001);
      await delay(250);
      const pointSecond = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      assertVisibleSnapshot('advancing core-owned point-cloud-fx', pointSecond, 0.0001);
      expect(pointSecond.checksum).not.toBe(pointFirst.checksum);

      const ridersLayerId = 'core-owned-smoke-riders';
      const ridersSourceId = 'core-owned-smoke-riders-output';
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upsert_layer',
            layer_id: ridersLayerId,
            z_index: 0,
            blend_mode: 'normal',
            opacity: 1,
            corners: FULLSCREEN_CORNERS,
          },
          { type: 'set_layer_visibility', layer_id: ridersLayerId, visible: true },
          {
            type: 'set_native_graph_layer',
            layer_id: ridersLayerId,
            kind: 'smoke-riders',
            instrument_source_id: ridersSourceId,
            composite_source_id: ridersSourceId,
            input_source_id: null,
            effect_graph: null,
            params: { quality: 'performance', sphereCount: 72, autoSpin: 18 },
          },
        ],
      }, 8000);
      await delay(500);
      const ridersFirst = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      assertVisibleSnapshot('core-owned smoke-riders', ridersFirst, 0.0002);
      await delay(300);
      const ridersSecond = await rpc.send('frame_snapshot', { include_pixels: false }, 8000);
      assertVisibleSnapshot('advancing core-owned smoke-riders', ridersSecond, 0.0002);
      expect(ridersSecond.checksum).not.toBe(ridersFirst.checksum);
    } finally {
      await rpc.close();
    }
  }, 30000);

  itIfNativeCore('advertises graph manifests that match the real native shader bundles', async () => {
    const rpc = createNativeRpc();
    try {
      const capabilities = await rpc.send('capabilities', {}, 5000);
      const features = capabilities?.features ?? {};
      const graphIds = sortedStrings((capabilities?.native_graph_instruments ?? []).map(String));
      const expectedIds = sortedStrings(EXPECTED_NATIVE_GRAPH_MANIFEST.map((entry) => entry.id));
      const graphManifest = new Map<string, Record<string, unknown>>(
        ((capabilities?.native_graph_instrument_manifest ?? []) as Record<string, unknown>[])
          .map((entry: Record<string, unknown>) => [String(entry?.id ?? ''), entry]),
      );

      expect(features.compute_graph_host).toBe(true);
      expect(features.compute_graph_render).toBe(true);
      expect(features.compute_graph_source_frame_target).toBe(true);
      expect(features.multi_pass_instruments).toBe(true);
      expect(features.native_instrument_proxies).toBe(false);
      expect(graphIds).toEqual(expectedIds);
      expect(sortedStrings(graphManifest.keys())).toEqual(expectedIds);

      for (const expected of EXPECTED_NATIVE_GRAPH_MANIFEST) {
        const entry = graphManifest.get(expected.id) as Record<string, unknown> | undefined;
        const shaderIds = sortedStrings(entry?.shader_ids as string[] | undefined ?? []);
        const manifestFeatures = new Set((entry?.features as string[] | undefined ?? []).map(String));

        expect(entry, expected.id).toBeTruthy();
        expect(features[expected.feature], expected.id).toBe(true);
        expect(entry?.render_target, expected.id).toBe('source_frame');
        expect(entry?.source_uri_prefix, expected.id).toBe(`native-graph://${expected.id}/`);
        expect(String(entry?.parity ?? ''), expected.id).not.toHaveLength(0);
        expect(manifestFeatures.has('compute_graph_host'), expected.id).toBe(true);
        expect(manifestFeatures.has('compute_graph_render'), expected.id).toBe(true);
        expect(manifestFeatures.has('compute_graph_source_frame_target'), expected.id).toBe(true);
        expect(manifestFeatures.has(expected.feature), expected.id).toBe(true);
        expect(shaderIds, expected.id).toEqual(sortedStrings(expected.shaderIds));
      }
    } finally {
      await rpc.close();
    }
  }, 15000);

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

  itIfNativeCore('executes native graph feature contract passes without proxy fallbacks', async () => {
    const rpc = createNativeRpc();
    const sourceId = 'native-graph-feature-contract-source';
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
      expect(capabilities?.features?.compute_graph_multi_render).toBe(true);
      expect(capabilities?.features?.compute_graph_instanced_render).toBe(true);
      expect(capabilities?.features?.compute_graph_indirect_render).toBe(true);
      expect(capabilities?.features?.compute_graph_texture_sampling).toBe(true);
      expect(capabilities?.features?.compute_graph_depth_render).toBe(true);
      expect(capabilities?.features?.compute_graph_line_render).toBe(true);
      expect(capabilities?.features?.compute_graph_source_frame_target).toBe(true);
      expect(capabilities?.features?.native_instrument_proxies).toBe(false);

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          {
            type: 'precompile_shader',
            shader_id: NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID,
            stage: 'module',
            entry: 'fs_tint',
            source: nativeGraphFeatureContractWgsl(),
          },
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

      const graphResult = await rpc.send('compute_graph', {
        buffers: [
          {
            id: 'native-graph-feature:red',
            kind: 'uniform',
            initial_f32: [0.88, 0.10, 0.08, 1, 0.24, 0, 0, 0],
          },
          {
            id: 'native-graph-feature:green',
            kind: 'uniform',
            initial_f32: [0.00, 0.78, 0.28, 1, 0.06, 0, 0, 0],
          },
          {
            id: 'native-graph-feature:blue',
            kind: 'uniform',
            initial_f32: [0.10, 0.22, 0.92, 1, 0.10, 0.12, -0.04, 0],
          },
          {
            id: 'native-graph-feature:yellow',
            kind: 'uniform',
            initial_f32: [0.95, 0.72, 0.10, 1, 0.02, 0, 0, 0],
          },
          {
            id: 'native-graph-feature:indirect',
            kind: 'storage',
            indirect: true,
            initial_u32: [3, 2, 0, 0],
          },
        ],
        passes: [],
        render_passes: [
          {
            name: 'feature-contract-source-seed',
            shader_id: NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID,
            vertex_entry: 'vs_triangle',
            fragment_entry: 'fs_tint',
            target: 'source_frame',
            source_id: sourceId,
            clear: true,
            clear_color: [0, 0, 0, 1],
            blend: 'replace',
            vertex_count: 3,
            instance_count: 2,
            bindings: [
              { binding: 0, resource: 'native-graph-feature:red', kind: 'uniform' },
            ],
          },
          {
            name: 'feature-contract-line-overlay',
            shader_id: NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID,
            vertex_entry: 'vs_line',
            fragment_entry: 'fs_tint',
            target: 'source_frame',
            source_id: sourceId,
            clear: false,
            blend: 'add',
            primitive: 'line-list',
            vertex_count: 2,
            bindings: [
              { binding: 0, resource: 'native-graph-feature:green', kind: 'uniform' },
            ],
          },
          {
            name: 'feature-contract-self-sample',
            shader_id: NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID,
            vertex_entry: 'vs_triangle',
            fragment_entry: 'fs_sample_add',
            target: 'source_frame',
            source_id: sourceId,
            clear: false,
            blend: 'alpha',
            vertex_count: 3,
            bindings: [
              { binding: 0, resource: 'native-graph-feature:blue', kind: 'uniform' },
              { binding: 1, kind: 'source-frame-texture', source_id: sourceId },
              { binding: 2, kind: 'source-frame-sampler' },
            ],
          },
          {
            name: 'feature-contract-indirect-depth',
            shader_id: NATIVE_GRAPH_FEATURE_CONTRACT_SHADER_ID,
            vertex_entry: 'vs_triangle',
            fragment_entry: 'fs_tint',
            target: 'snapshot',
            clear: true,
            clear_color: [0, 0, 0, 1],
            blend: 'replace',
            depth: true,
            depth_write: true,
            depth_compare: 'less-equal',
            draw_indirect_buffer: 'native-graph-feature:indirect',
            include_snapshot: true,
            bindings: [
              { binding: 0, resource: 'native-graph-feature:yellow', kind: 'uniform' },
            ],
          },
        ],
      }, 15000);

      const renders = Array.isArray(graphResult?.renders)
        ? graphResult.renders
        : graphResult?.render
          ? [graphResult.render]
          : [];
      expect(Number(graphResult?.pass_count ?? -1)).toBe(0);
      expect(renders).toHaveLength(4);
      expect(renders.some((render: Record<string, unknown>) => (
        render.name === 'feature-contract-source-seed' &&
        render.target === 'source_frame' &&
        render.source_id === sourceId &&
        render.instance_count === 2
      ))).toBe(true);
      expect(renders.some((render: Record<string, unknown>) => (
        render.name === 'feature-contract-line-overlay' &&
        render.primitive === 'line-list' &&
        render.blend === 'add'
      ))).toBe(true);
      expect(renders.some((render: Record<string, unknown>) => (
        render.name === 'feature-contract-self-sample' &&
        render.bindings === 3 &&
        render.target === 'source_frame'
      ))).toBe(true);
      expect(renders.some((render: Record<string, unknown>) => (
        render.name === 'feature-contract-indirect-depth' &&
        render.target === 'snapshot' &&
        render.draw === 'indirect' &&
        render.depth === true &&
        render.depth_compare === 'less-equal' &&
        render.indirect_buffer === 'native-graph-feature:indirect'
      ))).toBe(true);
      assertVisibleSnapshot('native graph feature contract snapshot', graphResult.render_snapshot as Record<string, unknown>, 0.006);

      const sourceProbe = await readSourceFrameProbe(rpc, sourceId, 'feature-contract-source', 128, 72);
      const [r, g, b] = meanRgbFromProbe(sourceProbe);
      expect(r + g + b).toBeGreaterThan(0.08);
      expect(Math.max(r, g, b)).toBeGreaterThan(0.05);
    } finally {
      await rpc.close();
    }
  }, 45000);

  itIfNativeCore('executes queued native compute graphs inside the live frame batch', async () => {
    const rpc = createNativeRpc();
    const sourceId = 'native-graph-queued-live-source';
    const colorBufferId = 'native-graph-queued-live:color';
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

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          {
            type: 'precompile_shader',
            shader_id: QUEUED_GRAPH_COMPUTE_SHADER_ID,
            stage: 'compute',
            entry: 'cs_seed',
            source: queuedGraphComputeWgsl(),
          },
          {
            type: 'precompile_shader',
            shader_id: QUEUED_GRAPH_RENDER_SHADER_ID,
            stage: 'module',
            entry: 'fs_color',
            source: queuedGraphRenderWgsl(),
          },
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

      const liveSummary = await rpc.send('submit_commands', {
        commands: [
          {
            type: 'queue_compute_graph',
            buffers: [{
              id: colorBufferId,
              kind: 'storage',
              byte_length: 16,
              persistent: true,
              clear: true,
            }],
            passes: [{
              name: 'queued-live-seed-color',
              shader_id: QUEUED_GRAPH_COMPUTE_SHADER_ID,
              entry: 'cs_seed',
              dispatch: [1, 1, 1],
              bindings: [
                { binding: 0, resource: colorBufferId, kind: 'storage' },
              ],
            }],
            render_passes: [{
              name: 'queued-live-render-source-frame',
              shader_id: QUEUED_GRAPH_RENDER_SHADER_ID,
              vertex_entry: 'vs_full',
              fragment_entry: 'fs_color',
              target: 'source_frame',
              source_id: sourceId,
              seq: 7,
              clear: true,
              clear_color: [0, 0, 0, 1],
              blend: 'replace',
              vertex_count: 3,
              bindings: [
                { binding: 0, resource: colorBufferId, kind: 'read-only-storage' },
              ],
            }],
            readbacks: [],
          },
          { type: 'present' },
        ],
      }, 12000);
      expect(Number(liveSummary?.dropped ?? 0)).toBe(0);
      await delay(180);

      const status = await rpc.send('status', {}, 5000);
      expect(Number(status?.compute_graph_runs ?? 0)).toBeGreaterThanOrEqual(1);
      expect(Number(status?.compute_graph_passes ?? 0)).toBeGreaterThanOrEqual(1);
      expect(Number(status?.compute_graph_source_frame_renders ?? 0)).toBeGreaterThanOrEqual(1);

      const sourceProbe = await readSourceFrameProbe(rpc, sourceId, 'queued-live-source', 128, 72);
      const [r, g, b] = meanRgbFromProbe(sourceProbe);
      expect(g).toBeGreaterThan(0.45);
      expect(r).toBeGreaterThan(0.05);
      expect(b).toBeGreaterThan(0.12);
    } finally {
      await rpc.close();
    }
  }, 45000);

  itIfNativeCore('updates source-driven native graph outputs when uploaded media frames change', async () => {
    const rpc = createNativeRpc();
    const mediaSourceId = 'native-graph-reactivity-media-source';
    const outputSize = { width: 160, height: 90 };
    try {
      await rpc.send('start', {
        config: {
          backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
          width: outputSize.width,
          height: outputSize.height,
          target_fps: 30,
          native_quality_policy: 'performance',
        },
      }, 12000);
      await delay(80);

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          ...buildPixelParticlesNativePrecompileCommands(),
          ...buildFlythroughNativePrecompileCommands(),
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

      const renderPixelParticles = async (label: string, rgb: [number, number, number], seq: number) => {
        await uploadTintedSourceFrame(rpc, mediaSourceId, rgb, seq);
        const graph = buildPixelParticlesNativeComputeGraph({
          sourceId: 'native-graph-reactivity-pixel-particles',
          mediaSourceId,
          params: {
            mode: 'identity',
            particleCount: 1024,
            baseSize: 0.038,
            opacity: 1,
            mirrorX: false,
          },
          width: outputSize.width,
          height: outputSize.height,
          sourceFrameSize: 32,
          time: 1.5,
          frameDelta: 1 / 30,
          frameIndex: 31,
          reset: true,
        });
        await rpc.send('compute_graph', encodeNativeGraphConfigForRpc(graph.config), 12000);
        return readSourceFrameProbe(
          rpc,
          'native-graph-reactivity-pixel-particles',
          `pixel-particles-${label}`,
          outputSize.width,
          outputSize.height,
        );
      };

      const renderFlythrough = async (label: string, rgb: [number, number, number], seq: number) => {
        await uploadTintedSourceFrame(rpc, mediaSourceId, rgb, seq);
        const graph = buildFlythroughNativeComputeGraph({
          sourceId: 'native-graph-reactivity-flythrough',
          mediaSourceId,
          params: {
            topology: 'strokes',
            particleCount: 2048,
            slabCount: 3,
            opacity: 1,
            flySpeed: 1.3,
            depthSource: 'luminance',
            audioReactive: true,
          },
          width: outputSize.width,
          height: outputSize.height,
          time: 1.5,
          frameDelta: 1 / 30,
          frameIndex: 41,
          audioBass: 0.55,
          audioTreble: 0.25,
          reset: true,
        });
        const particleBufferId = graph.config.buffers.find((buffer: Record<string, unknown>) => (
          typeof buffer.id === 'string' && buffer.id.endsWith(':particles')
        ))?.id as string | undefined;
        const graphConfig = {
          ...graph.config,
          readbacks: particleBufferId ? [{ id: particleBufferId, include_bytes: true }] : [],
        };
        const graphResult = await rpc.send('compute_graph', encodeNativeGraphConfigForRpc(graphConfig), 12000);
        const renders = Array.isArray(graphResult?.renders)
          ? graphResult.renders
          : graphResult?.render
            ? [graphResult.render]
            : [];
        expect(renders.some((render: Record<string, unknown>) => (
          render.target === 'source_frame' &&
          render.source_id === 'native-graph-reactivity-flythrough'
        )), `flythrough-${label}`).toBe(true);
        const snapshot = await snapshotSourceFrameLayer(
          rpc,
          'native-graph-reactivity-flythrough',
          `native-graph-reactivity-layer-flythrough-${label}`,
          `flythrough-${label}`,
          41,
          label === 'dark' ? null : 0.001,
        );
        return {
          ...snapshot,
          particleDepthMean: meanFlythroughDepthAnchor(
            particleBufferId ? graphResult?.readbacks?.[particleBufferId] : undefined,
          ),
        };
      };

      const pixelRed = await renderPixelParticles('red', [230, 32, 28], 11);
      const pixelBlue = await renderPixelParticles('blue', [24, 80, 245], 12);
      expect(String(pixelBlue.checksum)).not.toBe(String(pixelRed.checksum));
      expect(rgbDistance(meanRgbFromProbe(pixelRed), meanRgbFromProbe(pixelBlue))).toBeGreaterThan(0.05);

      const flyBright = await renderFlythrough('bright', [245, 245, 245], 21);
      const flyDark = await renderFlythrough('dark', [2, 2, 2], 22);
      expect(String(flyDark.checksum)).not.toBe(String(flyBright.checksum));
      expect(Number(flyBright.particleDepthMean ?? 0)).toBeGreaterThan(Number(flyDark.particleDepthMean ?? 0) + 0.2);
    } finally {
      await rpc.close();
    }
  }, 60000);

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

      const pointCloudFixture = makePointCloudFixture(768);
      const pointCloudData = buildPointCloudFXNativePointData(
        pointCloudFixture.positions,
        pointCloudFixture.colors,
        {
          maxPoints: 768,
          signature: 'native-graph-fixture-point-cloud-fx-data',
          pointSize: 0.018,
        },
      );

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
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(400);
            expect(Number(snapshot.bright_pixels ?? 0)).toBeGreaterThan(40);
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
          id: 'point-cloud-fx',
          graph: buildPointCloudFXNativeComputeGraph({
            sourceId: 'native-graph-fixture-point-cloud-fx',
            pointData: pointCloudData,
            params: {
              topology: 'billboards',
              pointSize: 0.018,
              colorMode: 'palette4',
              colorMap: 'radial',
              colorA: [80, 210, 255],
              colorB: [255, 75, 180],
              colorC: [255, 210, 80],
              colorD: [80, 255, 170],
              windStrength: 0.18,
              waveEnabled: true,
              waveStrength: 0.6,
              autoRotateY: 10,
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
          minLuma: 0.003,
          assert(snapshot: Record<string, unknown>) {
            expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(30);
          },
        },
        {
          id: 'point-cloud-fx-gaussian',
          graph: buildPointCloudFXNativeComputeGraph({
            sourceId: 'native-graph-fixture-point-cloud-fx-gaussian',
            pointData: makeGaussianPointCloudFixture(128),
            params: {
              topology: 'billboards',
              pointSize: 0.026,
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
