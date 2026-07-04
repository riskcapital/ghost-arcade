import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSmoke3DNativeComputeGraph,
  buildSmoke3DNativePrecompileCommands,
  type Smoke3DNativeGraphState,
} from '../../src/lib/renderer/webgpu3DSmoke';

const RUN_NATIVE_INTEGRATION = process.env.GA_NATIVE_SMOKE3D_INTEGRATION === '1';
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

const maybeIt = RUN_NATIVE_INTEGRATION ? it : it.skip;

describe('3D Smoke native renderer integration', () => {
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
    expect(capabilities.features.compute_graph_source_frame_target).toBe(true);
    expect(capabilities.features.native_3d_smoke_graph).toBe(true);
    expect(capabilities.native_graph_instruments).toContain('smoke-3d');
    expect(capabilities.native_graph_instrument_manifest).toContainEqual(
      expect.objectContaining({
        id: 'smoke-3d',
        source_uri_prefix: 'native-graph://smoke-3d/',
        render_target: 'source_frame',
      }),
    );

    await rpc.send('submit_commands', {
      commands: buildSmoke3DNativePrecompileCommands(),
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
  }, 60000);
});
