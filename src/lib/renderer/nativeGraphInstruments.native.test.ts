import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildParticleFieldNativeComputeGraph,
  buildParticleFieldNativePrecompileCommands,
} from './webgpuParticleField';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
} from './webgpuPixelParticles';
import {
  buildPlanetNativeComputeGraph,
  buildPlanetNativePrecompileCommands,
} from './shaders/webgpuPlanet';
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

describe('Native graph instrument runtime fixtures', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

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
        'particle-field',
        'pixel-particles',
        'volumetric-spheres',
      ]));

      const precompileSummary = await rpc.send('submit_commands', {
        commands: [
          ...buildPlanetNativePrecompileCommands(),
          ...buildVolumetricSpheresNativePrecompileCommands(),
          ...buildParticleFieldNativePrecompileCommands(),
          ...buildPixelParticlesNativePrecompileCommands(),
        ],
      }, 8000);
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
      ];

      const checksums = new Set<string>();
      for (const fixture of fixtures) {
        const graphResult = await rpc.send('compute_graph', fixture.graph.config, 12000);
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
  }, 45000);
});
