import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSmoke3DNativeComputeGraph,
  buildSmoke3DNativePrecompileCommands,
  type Smoke3DNativeGraphState,
} from '../../src/lib/renderer/webgpu3DSmoke';
import {
  buildParticleFieldNativeComputeGraph,
  buildParticleFieldNativePrecompileCommands,
  type ParticleFieldNativeGraphState,
} from '../../src/lib/renderer/webgpuParticleField';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
  type PixelParticlesNativeGraphState,
} from '../../src/lib/renderer/webgpuPixelParticles';
import {
  buildPointCloudFXNativeComputeGraph,
  buildPointCloudFXNativePointData,
  buildPointCloudFXNativePrecompileCommands,
  type PointCloudFXNativeGraphState,
} from '../../src/lib/renderer/webgpuPointCloudFX';
import {
  buildFlythroughNativeComputeGraph,
  buildFlythroughNativePrecompileCommands,
  type FlythroughNativeGraphState,
} from '../../src/lib/renderer/webgpuFlythrough';
import {
  buildInkCloudNativeComputeGraph,
  buildInkCloudNativePrecompileCommands,
  type InkCloudNativeGraphState,
} from '../../src/lib/renderer/webgpuInkCloud';
import {
  buildPlanetNativeComputeGraph,
  buildPlanetNativePrecompileCommands,
  type PlanetNativeGraphState,
} from '../../src/lib/renderer/shaders/webgpuPlanet';
import {
  buildSmokeRidersNativeComputeGraph,
  type SmokeRidersNativeGraphState,
} from '../../src/lib/renderer/shaders/webgpuSmokeRidersShader';
import {
  buildVolumetricSpheresNativeComputeGraph,
  buildVolumetricSpheresNativePrecompileCommands,
  type VolumetricSpheresNativeGraphState,
} from '../../src/lib/renderer/shaders/webgpuVolumetricSpheresShader';

const RUN_NATIVE_INTEGRATION =
  process.env.GA_NATIVE_GRAPH_PARITY === '1' ||
  process.env.GA_NATIVE_SMOKE3D_INTEGRATION === '1';
const root = process.cwd();
const bin = join(
  root,
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

type RpcProcess = {
  child: ChildProcessWithoutNullStreams;
  send<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  close(): Promise<string>;
};

function createRpcProcess(): RpcProcess {
  if (!existsSync(bin)) {
    throw new Error(`native render-core binary is missing: ${bin}; run npm run native:build first`);
  }
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, {
    method: string;
    timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(err: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line);
        const wait = pending.get(message.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const send = <T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 8000) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native render-core timed out handling ${method}`));
      }, timeoutMs);
      pending.set(id, { method, timer, resolve: resolve as any, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  const close = async () => {
    try {
      await send('shutdown', {}, 1000);
    } catch {
      // The process may already be gone after a failed assertion.
    }
    child.kill();
    return stderr.trim();
  };

  return { child, send, close };
}

function assertVisibleFrame(label: string, snapshot: any, minLuma = 0.01) {
  const luma = Number(snapshot?.average_luma ?? 0);
  const nonzero = Number(snapshot?.nonzero_pixels ?? 0);
  if (snapshot?.dark_frame || luma < minLuma || nonzero <= 0) {
    throw new Error(`${label} rendered blank: dark=${snapshot?.dark_frame} luma=${luma} nonzero=${nonzero}`);
  }
}

function makeSourceFrameB64(width: number, height: number): string {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const u = width > 1 ? x / (width - 1) : 0;
      const v = height > 1 ? y / (height - 1) : 0;
      const stripe = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0;
      pixels[i + 0] = Math.round(255 * (stripe ? 1 : u));
      pixels[i + 1] = Math.round(255 * (0.2 + v * 0.8));
      pixels[i + 2] = Math.round(255 * (stripe ? 0.35 : 1 - u * 0.5));
      pixels[i + 3] = 255;
    }
  }
  return pixels.toString('base64');
}

function makePointCloudData(count = 8192) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const ring = Math.floor(t * 12);
    const local = (t * 12) % 1;
    const angle = local * Math.PI * 2 + ring * 0.31;
    const radius = 0.28 + ring * 0.055;
    positions[i * 3 + 0] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius * 0.72 + Math.sin(t * Math.PI * 14) * 0.08;
    positions[i * 3 + 2] = (t - 0.5) * 1.6 + Math.cos(angle * 3) * 0.08;
    colors[i * 3 + 0] = 0.2 + 0.8 * local;
    colors[i * 3 + 1] = 0.15 + 0.85 * (1 - t);
    colors[i * 3 + 2] = 0.45 + 0.55 * Math.sin(angle * 0.5) ** 2;
  }
  return buildPointCloudFXNativePointData(positions, colors, {
    maxPoints: count,
    signature: `integration-cloud:${count}`,
  });
}

const maybeIt = RUN_NATIVE_INTEGRATION ? it : it.skip;

describe('Native graph parity and health integration', () => {
  let rpc: RpcProcess | null = null;

  afterEach(async () => {
    if (!rpc) return;
    const stderr = await rpc.close();
    rpc = null;
    if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
  });

  maybeIt('executes the real 3D Smoke graph in the Rust core and composites it as a source frame', async () => {
    if (typeof (globalThis as any).btoa !== 'function') {
      (globalThis as any).btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
    }
    rpc = createRpcProcess();
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    }, 12000);

    const capabilities = await rpc.send('capabilities', {}, 5000);
    expect(capabilities.features.compute_graph_host).toBe(true);
    expect(capabilities.features.compute_graph_render).toBe(true);
    expect(capabilities.features.compute_graph_multi_render).toBe(true);
    expect(capabilities.features.compute_graph_instanced_render).toBe(true);
    expect(capabilities.features.compute_graph_indirect_render).toBe(true);
    expect(capabilities.features.compute_graph_texture_sampling).toBe(true);
    expect(capabilities.features.compute_graph_depth_render).toBe(true);
    expect(capabilities.features.compute_graph_line_render).toBe(true);
    expect(capabilities.features.compute_graph_source_frame_target).toBe(true);
    expect(capabilities.features.native_planet_graph).toBe(true);
    expect(capabilities.features.native_3d_smoke_graph).toBe(true);
    expect(capabilities.features.native_particle_field_graph).toBe(true);
    expect(capabilities.features.native_volumetric_spheres_graph).toBe(true);
    expect(capabilities.features.native_smoke_riders_graph).toBe(true);
    expect(capabilities.features.native_ink_cloud_graph).toBe(true);
    expect(capabilities.features.native_flythrough_graph).toBe(true);
    expect(capabilities.features.native_pixel_particles_graph).toBe(true);
    expect(capabilities.features.native_point_cloud_fx_graph).toBe(true);
    expect(capabilities.native_graph_instruments).toContain('planet');
    expect(capabilities.native_graph_instruments).toContain('smoke-3d');
    expect(capabilities.native_graph_instruments).toContain('particle-field');
    expect(capabilities.native_graph_instruments).toContain('volumetric-spheres');
    expect(capabilities.native_graph_instruments).toContain('smoke-riders');
    expect(capabilities.native_graph_instruments).toContain('ink-cloud');
    expect(capabilities.native_graph_instruments).toContain('flythrough');
    expect(capabilities.native_graph_instruments).toContain('pixel-particles');
    expect(capabilities.native_graph_instruments).toContain('point-cloud-fx');
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'planet',
        source_uri_prefix: 'native-graph://planet/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'smoke-3d',
        source_uri_prefix: 'native-graph://smoke-3d/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'particle-field',
        source_uri_prefix: 'native-graph://particle-field/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'volumetric-spheres',
        source_uri_prefix: 'native-graph://volumetric-spheres/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'smoke-riders',
        source_uri_prefix: 'native-graph://smoke-riders/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'ink-cloud',
        source_uri_prefix: 'native-graph://ink-cloud/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'flythrough',
        source_uri_prefix: 'native-graph://flythrough/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'pixel-particles',
        source_uri_prefix: 'native-graph://pixel-particles/',
        render_target: 'source_frame',
      }),
    );
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'point-cloud-fx',
        source_uri_prefix: 'native-graph://point-cloud-fx/',
        render_target: 'source_frame',
      }),
    );

    await rpc.send('submit_commands', {
      commands: [
        ...buildPlanetNativePrecompileCommands(),
        ...buildSmoke3DNativePrecompileCommands(),
        ...buildParticleFieldNativePrecompileCommands(),
        ...buildVolumetricSpheresNativePrecompileCommands(),
        ...buildInkCloudNativePrecompileCommands(),
        ...buildFlythroughNativePrecompileCommands(),
        ...buildPixelParticlesNativePrecompileCommands(),
        ...buildPointCloudFXNativePrecompileCommands(),
      ],
    }, 10000);

    const sourceId = 'gpu:integration-smoke:smoke-3d';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-smoke-3d', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-smoke-3d', visible: true },
        { type: 'bind_media_source', layer_id: 'native-smoke-3d', source_id: sourceId, uri: 'native-graph://smoke-3d/integration', source_type: 'image' },
      ],
    });

    let state: Smoke3DNativeGraphState | null = null;
    let graphResult: any = null;
    const frameChecksums = new Set<string>();
    for (let frame = 0; frame < 3; frame++) {
      const graph = buildSmoke3DNativeComputeGraph({
        sourceId,
        params: {
          gridSize: 32,
          emitterCount: 4,
          splatRate: 60,
          emission: 3.2,
          density: 3.5,
          fogOpacity: 1,
          shadowSteps: 2,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        state,
        reset: frame === 0,
      });
      state = graph.state;
      graphResult = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(graphResult.pass_count).toBe(25);
      expect(graphResult.render).toMatchObject({
        target: 'source_frame',
        source_id: sourceId,
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.1 + frame / 30,
        frame_index: frame + 4,
      }, 10000);
      assertVisibleFrame(`native 3D Smoke source-frame layer ${frame}`, snapshot, 0.015);
      expect(snapshot.checksum).toBeTruthy();
      frameChecksums.add(String(snapshot.checksum));
    }
    expect(frameChecksums.size).toBeGreaterThan(1);

    const status = await rpc.send('status', {}, 5000);
    expect(Number(status.source_frames_active ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(status.compute_graph_runs ?? 0)).toBeGreaterThanOrEqual(3);
    expect(Number(status.compute_graph_passes ?? 0)).toBeGreaterThanOrEqual(75);
    expect(Number(status.compute_graph_render_passes ?? 0)).toBeGreaterThanOrEqual(3);
    expect(Number(status.compute_graph_source_frame_renders ?? 0)).toBeGreaterThanOrEqual(3);
    expect(Number(status.compute_graph_persistent_buffers ?? graphResult.persistent_buffer_count ?? 0)).toBeGreaterThanOrEqual(7);
    expect(Number(status.native_graph_source_frame_layers ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(status.native_instrument_proxy_layers ?? 0)).toBe(0);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-smoke-3d' },
      ],
    });

    const particleSourceId = 'gpu:integration-particles:particle-field';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-particle-field', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-particle-field', visible: true },
        { type: 'bind_media_source', layer_id: 'native-particle-field', source_id: particleSourceId, uri: 'native-graph://particle-field/integration', source_type: 'image' },
      ],
    });

    let particleState: ParticleFieldNativeGraphState | null = null;
    const particleChecksums = new Set<string>();
    for (let frame = 0; frame < 3; frame++) {
      const graph = buildParticleFieldNativeComputeGraph({
        sourceId: particleSourceId,
        params: {
          mode: 'gravity',
          topology: 'softSphere',
          particleCount: 2048,
          connectEnabled: true,
          partnerCount: 4,
          fogOpacity: 0.75,
          bass: frame === 1 ? 0.65 : 0.35,
          treble: 0.25,
          baseSize: 0.018,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        state: particleState,
        reset: frame === 0,
      });
      particleState = graph.state;
      const particleResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(particleResult.pass_count).toBe(2);
      expect(particleResult.renders).toHaveLength(3);
      expect(particleResult.renders[1]).toMatchObject({
        target: 'source_frame',
        source_id: particleSourceId,
        depth: true,
      });
      expect(particleResult.renders[2]).toMatchObject({
        target: 'source_frame',
        source_id: particleSourceId,
        draw: 'indirect',
        primitive: 'line-list',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.3 + frame / 30,
        frame_index: frame + 8,
      }, 10000);
      assertVisibleFrame(`native Particle Field source-frame layer ${frame}`, snapshot, 0.01);
      particleChecksums.add(String(snapshot.checksum));
    }
    expect(particleChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-particle-field' },
      ],
    });

    const volumetricSourceId = 'gpu:integration-spheres:volumetric-spheres';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-volumetric-spheres', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-volumetric-spheres', visible: true },
        { type: 'bind_media_source', layer_id: 'native-volumetric-spheres', source_id: volumetricSourceId, uri: 'native-graph://volumetric-spheres/integration', source_type: 'image' },
      ],
    });

    let volumetricState: VolumetricSpheresNativeGraphState | null = null;
    const volumetricChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildVolumetricSpheresNativeComputeGraph({
        sourceId: volumetricSourceId,
        params: {
          layout: 'orbital',
          sphereCount: 96,
          autoRotateY: 5,
          audioReactive: true,
          bass: frame === 0 ? 0.25 : 0.65,
          backgroundOpacity: 1,
          colorA: [70, 170, 255],
          colorB: [255, 78, 166],
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        audioBass: frame === 0 ? 0.25 : 0.65,
        audioTreble: 0.35,
        state: volumetricState,
        reset: frame === 0,
      });
      volumetricState = graph.state;
      const volumetricResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(volumetricResult.pass_count).toBe(1);
      expect(volumetricResult.renders).toHaveLength(1);
      expect(volumetricResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: volumetricSourceId,
        depth: true,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.42 + frame / 30,
        frame_index: frame + 10,
      }, 10000);
      assertVisibleFrame(`native Volumetric Spheres source-frame layer ${frame}`, snapshot, 0.006);
      volumetricChecksums.add(String(snapshot.checksum));
    }
    expect(volumetricChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-volumetric-spheres' },
      ],
    });

    const ridersSourceId = 'gpu:integration-riders:smoke-riders';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-smoke-riders', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-smoke-riders', visible: true },
        { type: 'bind_media_source', layer_id: 'native-smoke-riders', source_id: ridersSourceId, uri: 'native-graph://smoke-riders/integration', source_type: 'image' },
      ],
    });

    let ridersState: SmokeRidersNativeGraphState | null = null;
    const ridersChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildSmokeRidersNativeComputeGraph({
        sourceId: ridersSourceId,
        params: {
          quality: 'performance',
          style: 'orbital',
          sphereCount: 96,
          smokeDensity: 2.4,
          bassDrive: 1.5,
          audioReactive: true,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        audioBass: frame === 0 ? 0.35 : 0.7,
        audioTreble: 0.25,
        state: ridersState,
        reset: frame === 0,
      });
      ridersState = graph.state;
      const ridersResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 30000);
      expect(ridersResult.pass_count).toBeGreaterThanOrEqual(26);
      expect(ridersResult.renders).toHaveLength(2);
      expect(ridersResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: ridersSourceId,
        blend: 'replace',
      });
      expect(ridersResult.renders[1]).toMatchObject({
        target: 'source_frame',
        source_id: ridersSourceId,
        depth: true,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.46 + frame / 30,
        frame_index: frame + 12,
      }, 10000);
      assertVisibleFrame(`native Smoke Riders source-frame layer ${frame}`, snapshot, 0.006);
      ridersChecksums.add(String(snapshot.checksum));
    }
    expect(ridersChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-smoke-riders' },
      ],
    });

    const inkSourceId = 'gpu:integration-ink:ink-cloud';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-ink-cloud', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-ink-cloud', visible: true },
        { type: 'bind_media_source', layer_id: 'native-ink-cloud', source_id: inkSourceId, uri: 'native-graph://ink-cloud/integration', source_type: 'image' },
      ],
    });

    let inkState: InkCloudNativeGraphState | null = null;
    const inkChecksums = new Set<string>();
    for (let frame = 0; frame < 3; frame++) {
      const graph = buildInkCloudNativeComputeGraph({
        sourceId: inkSourceId,
        params: {
          particleCount: 8192,
          emitterCount: 4,
          spread: 0.46,
          bgOpacity: 1,
          alphaScale: 0.85,
          brightness: 1.45,
          autoRotateY: 6,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        audioBass: frame === 1 ? 0.8 : 0.35,
        audioTreble: 0.42,
        state: inkState,
        reset: frame === 0,
      });
      inkState = graph.state;
      const inkResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(inkResult.pass_count).toBe(1);
      expect(inkResult.renders).toHaveLength(2);
      expect(inkResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: inkSourceId,
        blend: 'alpha',
      });
      expect(inkResult.renders[1]).toMatchObject({
        target: 'source_frame',
        source_id: inkSourceId,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.5 + frame / 30,
        frame_index: frame + 12,
      }, 10000);
      assertVisibleFrame(`native Ink Cloud source-frame layer ${frame}`, snapshot, 0.01);
      inkChecksums.add(String(snapshot.checksum));
    }
    expect(inkChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-ink-cloud' },
      ],
    });

    const flySourceId = 'gpu:integration-fly:flythrough';
    const flyInputSourceId = 'media:integration-fly-source';
    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upload_source_frame',
          source_id: flyInputSourceId,
          width: 64,
          height: 64,
          rgba_b64: makeSourceFrameB64(64, 64),
          seq: 1,
        },
        { type: 'upsert_layer', layer_id: 'native-flythrough', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-flythrough', visible: true },
        { type: 'bind_media_source', layer_id: 'native-flythrough', source_id: flySourceId, uri: 'native-graph://flythrough/integration', source_type: 'image' },
      ],
    });

    let flyState: FlythroughNativeGraphState | null = null;
    const flyChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildFlythroughNativeComputeGraph({
        sourceId: flySourceId,
        mediaSourceId: flyInputSourceId,
        params: {
          topology: 'strokes',
          particleCount: 4096,
          slabCount: 2,
          flySpeed: 1.1,
          strokeLength: 0.12,
          strokeWidth: 0.012,
          opacity: 1,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        state: flyState,
        reset: frame === 0,
      });
      flyState = graph.state;
      const flyResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(flyResult.pass_count).toBe(1);
      expect(flyResult.renders).toHaveLength(1);
      expect(flyResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: flySourceId,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.65 + frame / 30,
        frame_index: frame + 15,
      }, 10000);
      assertVisibleFrame(`native Flythrough source-frame layer ${frame}`, snapshot, 0.003);
      flyChecksums.add(String(snapshot.checksum));
    }
    expect(flyChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-flythrough' },
      ],
    });

    const pixelSourceId = 'gpu:integration-pixels:pixel-particles';
    const pixelInputSourceId = 'media:integration-pixel-source';
    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upload_source_frame',
          source_id: pixelInputSourceId,
          width: 64,
          height: 64,
          rgba_b64: makeSourceFrameB64(64, 64),
          seq: 1,
        },
        { type: 'upsert_layer', layer_id: 'native-pixel-particles', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-pixel-particles', visible: true },
        { type: 'bind_media_source', layer_id: 'native-pixel-particles', source_id: pixelSourceId, uri: 'native-graph://pixel-particles/integration', source_type: 'image' },
      ],
    });

    let pixelState: PixelParticlesNativeGraphState | null = null;
    const pixelChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildPixelParticlesNativeComputeGraph({
        sourceId: pixelSourceId,
        mediaSourceId: pixelInputSourceId,
        params: {
          mode: 'depth-shift',
          particleCount: 4096,
          depthAmount: 0.8,
          depthMotion: frame === 0 ? 'locked' : 'drift',
          depthMotionAmount: 0.15,
          baseSize: 0.012,
          opacity: 1,
        },
        width: 320,
        height: 180,
        sourceFrameSize: 256,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        state: pixelState,
        reset: frame === 0,
      });
      pixelState = graph.state;
      const pixelResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(pixelResult.pass_count).toBe(1);
      expect(pixelResult.renders).toHaveLength(1);
      expect(pixelResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: pixelSourceId,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.72 + frame / 30,
        frame_index: frame + 17,
      }, 10000);
      assertVisibleFrame(`native Pixel Particles source-frame layer ${frame}`, snapshot, 0.003);
      pixelChecksums.add(String(snapshot.checksum));
    }
    expect(pixelChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-pixel-particles' },
      ],
    });

    const pointCloudSourceId = 'gpu:integration-point-cloud:point-cloud-fx';
    const pointCloudData = makePointCloudData(8192);
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-point-cloud-fx', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-point-cloud-fx', visible: true },
        { type: 'bind_media_source', layer_id: 'native-point-cloud-fx', source_id: pointCloudSourceId, uri: 'native-graph://point-cloud-fx/integration', source_type: 'image' },
      ],
    });

    let pointCloudState: PointCloudFXNativeGraphState | null = null;
    const pointCloudChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildPointCloudFXNativeComputeGraph({
        sourceId: pointCloudSourceId,
        pointData: pointCloudData,
        params: {
          topology: frame === 0 ? 'billboards' : 'strokes',
          pointSize: 0.01,
          strokeLength: 0.08,
          strokeWidth: 0.009,
          colorMode: 'palette4',
          colorMap: 'radial',
          colorMix: 0.8,
          colorA: [60, 100, 240],
          colorB: [240, 60, 180],
          colorC: [255, 200, 30],
          colorD: [40, 220, 220],
          windStrength: 0.08,
          waveStrength: 1.1,
          opacity: 1,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        audioBass: frame === 0 ? 0.5 : 0.2,
        audioTreble: 0.25,
        state: pointCloudState,
        reset: frame === 0,
      });
      pointCloudState = graph.state;
      const pointResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(pointResult.pass_count).toBe(1);
      expect(pointResult.renders).toHaveLength(1);
      expect(pointResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: pointCloudSourceId,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.76 + frame / 30,
        frame_index: frame + 19,
      }, 10000);
      assertVisibleFrame(`native Point Cloud FX source-frame layer ${frame}`, snapshot, 0.003);
      pointCloudChecksums.add(String(snapshot.checksum));
    }
    expect(pointCloudChecksums.size).toBeGreaterThan(1);

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'native-point-cloud-fx' },
      ],
    });

    const planetSourceId = 'gpu:integration-planet:planet';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'native-planet', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'native-planet', visible: true },
        { type: 'bind_media_source', layer_id: 'native-planet', source_id: planetSourceId, uri: 'native-graph://planet/integration', source_type: 'image' },
      ],
    });

    let planetState: PlanetNativeGraphState | null = null;
    const planetChecksums = new Set<string>();
    for (let frame = 0; frame < 2; frame++) {
      const graph = buildPlanetNativeComputeGraph({
        sourceId: planetSourceId,
        params: {
          planet: frame === 0 ? 'earth' : 'saturn',
          cameraDistance: 3.6,
          rotationSpeed: 10,
          cloudSpeed: 0.8,
          starDensity: 1.2,
        },
        width: 320,
        height: 180,
        time: frame / 30,
        frameDelta: 1 / 30,
        frameIndex: frame + 1,
        state: planetState,
        reset: frame === 0,
      });
      planetState = graph.state;
      const planetResult: any = await rpc.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      expect(planetResult.pass_count).toBe(0);
      expect(planetResult.renders).toHaveLength(1);
      expect(planetResult.renders[0]).toMatchObject({
        target: 'source_frame',
        source_id: planetSourceId,
        blend: 'alpha',
      });
      const snapshot = await rpc.send('frame_snapshot', {
        include_pixels: false,
        time: 0.7 + frame / 30,
        frame_index: frame + 18,
      }, 10000);
      assertVisibleFrame(`native Planet source-frame layer ${frame}`, snapshot, 0.01);
      planetChecksums.add(String(snapshot.checksum));
    }
    expect(planetChecksums.size).toBeGreaterThan(1);
  }, 90000);

  maybeIt('replays native graph frames deterministically under the manual render clock', async () => {
    if (typeof (globalThis as any).btoa !== 'function') {
      (globalThis as any).btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
    }
    rpc = createRpcProcess();
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    }, 12000);
    await rpc.send('submit_commands', {
      commands: buildPlanetNativePrecompileCommands(),
    }, 10000);

    const sourceId = 'gpu:manual-clock-planet:planet';
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'manual-clock-planet', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'manual-clock-planet', visible: true },
        { type: 'bind_media_source', layer_id: 'manual-clock-planet', source_id: sourceId, uri: 'native-graph://planet/manual-clock', source_type: 'image' },
      ],
    });

    const renderPlanet = async (time: number, frameIndex: number) => {
      await rpc!.send('set_render_clock', {
        mode: 'manual',
        time,
        time_delta: 1 / 30,
        frame_index: frameIndex,
      });
      const graph = buildPlanetNativeComputeGraph({
        sourceId,
        params: {
          planet: 'jupiter',
          cameraDistance: 3.4,
          rotationSpeed: 8,
          cloudSpeed: 0.6,
          starDensity: 1.1,
        },
        width: 320,
        height: 180,
        time,
        frameDelta: 1 / 30,
        frameIndex,
        state: null,
        reset: true,
      });
      await rpc!.send('compute_graph', graph.config as unknown as Record<string, unknown>, 20000);
      const snapshot = await rpc!.send('frame_snapshot', {
        include_pixels: false,
        time,
        frame_index: frameIndex,
      }, 10000);
      assertVisibleFrame(`manual-clock planet t=${time}`, snapshot, 0.01);
      return snapshot;
    };

    const first = await renderPlanet(1.25, 42);
    const replay = await renderPlanet(1.25, 42);
    const advanced = await renderPlanet(1.75, 57);
    expect(replay.checksum).toBe(first.checksum);
    expect(advanced.checksum).not.toBe(first.checksum);

    const status = await rpc.send('status', {}, 5000);
    expect(status.render_clock_mode).toBe('manual');
    expect(Number(status.render_clock_frame_index ?? 0)).toBe(57);
    expect(Number(status.render_clock_updates ?? 0)).toBeGreaterThanOrEqual(3);
  }, 60000);
});
