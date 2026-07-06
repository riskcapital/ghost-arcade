import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
};

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

  const send: NativeRpc['send'] = (method, params = {}, timeoutMs = 5000) =>
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
        // The process may already be gone after an assertion failure.
      }
      child.kill();
    },
  };
}

function assertSnapshotPixels(label: string, snapshot: Record<string, unknown>): Uint8Array {
  expect(snapshot.includes_pixels, label).toBe(true);
  expect(String(snapshot.checksum ?? ''), label).toHaveLength(16);
  const width = Number(snapshot.width ?? 0);
  const height = Number(snapshot.height ?? 0);
  const data = typeof snapshot.rgba_b64 === 'string'
    ? Buffer.from(snapshot.rgba_b64, 'base64')
    : null;
  expect(data?.byteLength ?? 0, label).toBe(width * height * 4);
  return new Uint8Array(data ?? []);
}

function averagePixelDelta(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.byteLength, b.byteLength);
  if (length <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    sum += Math.abs(a[i] - b[i]);
    sum += Math.abs(a[i + 1] - b[i + 1]);
    sum += Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / Math.max(1, Math.floor(length / 4) * 3);
}

describe('Native render-core RPC contract', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
  const nativeBackend =
    process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan';
  const nativeSharedTexturePlatform =
    process.platform === 'darwin' ? 'iosurface' : process.platform === 'win32' ? 'dxgi' : null;
  const nativeSharedTextureDetail =
    process.platform === 'darwin' ? 'IOSurfaceID' : process.platform === 'win32' ? 'DXGI shared HANDLE' : '';

  itIfNativeCore('advertises implemented methods and rejects unknown RPC methods', async () => {
    const rpc = createNativeRpc();
    try {
      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.implemented_methods).toEqual(expect.arrayContaining([
        'get_capabilities',
        'submit_commands',
        'compute_graph',
        'shutdown',
      ]));
      expect(capabilities?.implemented_methods).not.toContain('definitely_not_a_real_rpc');
      expect(capabilities?.features?.native_instrument_proxies).toBe(false);

      await expect(rpc.send('definitely_not_a_real_rpc')).rejects.toThrow(
        'unsupported native render-core RPC method `definitely_not_a_real_rpc`',
      );
    } finally {
      await rpc.close();
    }
  }, 10000);

  itIfNativeCore('keeps raw frame export distinct from Electron recording readiness', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 96,
          height: 54,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      await rpc.send('submit_commands', {
        time: 0.1,
        frame_index: 1,
        layers: [],
      }, 8000);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.frame_snapshot_export).toBe(true);
      expect(capabilities?.features?.native_frame_export).toBe(true);
      expect(capabilities?.features?.native_frame_sequence_export).toBe(true);
      expect(capabilities?.features?.native_recording).toBe(false);
      if (nativeSharedTexturePlatform) {
        expect(capabilities?.features?.shared_texture_source_frame_upload).toBe(true);
        expect(capabilities?.features?.shared_texture_upload).toBe(true);
        expect(capabilities?.features?.shared_texture_output_export).toBe(true);
      } else {
        expect(capabilities?.features?.shared_texture_upload).toBe(false);
      }

      const readiness = await rpc.send('get_readiness_report');
      const checks = new Map<string, any>((readiness?.checks ?? []).map((check: any) => [check?.id, check]));
      expect(checks.get('native-frame-export')?.ok).toBe(true);
      expect(checks.get('native-frame-sequence-export')?.ok).toBe(true);
      expect(checks.get('native-recording')?.ok).toBe(false);
      expect(String(checks.get('native-recording')?.detail ?? '')).toContain('Electron broker');
      if (nativeSharedTexturePlatform) {
        expect(checks.get('shared-texture-source-frame-upload')?.ok).toBe(true);
        expect(checks.get('shared-texture-upload')?.ok).toBe(true);
        expect(String(checks.get('shared-texture-upload')?.detail ?? '')).toContain(nativeSharedTextureDetail);
        expect(checks.get('shared-texture-output-export')?.ok).toBe(true);
        const outputTexture = await rpc.send('output_shared_texture');
        expect(outputTexture?.available).toBe(true);
        expect(outputTexture?.platform).toBe(nativeSharedTexturePlatform);
        expect(Number(outputTexture?.handle ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.handle_byte_length ?? 0)).toBe(
          nativeSharedTexturePlatform === 'iosurface' ? 4 : 8,
        );
        expect(outputTexture?.handle_scope).toBe(
          nativeSharedTexturePlatform === 'iosurface' ? 'global-id' : 'process-local',
        );
        expect(outputTexture?.preferred_transport).toBe(
          nativeSharedTexturePlatform === 'iosurface' ? 'handle' : 'shared_name',
        );
        if (nativeSharedTexturePlatform === 'dxgi') {
          expect(String(outputTexture?.shared_name ?? '')).toContain('GhostArcadeNativeOutput');
        }
        expect(Number(outputTexture?.frame ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.width ?? 0)).toBeGreaterThan(0);
        expect(Number(outputTexture?.height ?? 0)).toBeGreaterThan(0);
      } else {
        expect(checks.get('shared-texture-upload')?.ok).toBe(false);
      }
    } finally {
      await rpc.close();
    }
  }, 20000);

  itIfNativeCore('captures Stage3D mesh scenes through the native frame snapshot path', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.native_stage3d_output_renderer).toBe(true);
      expect(capabilities?.features?.native_stage3d_recording_parity).toBe(true);

      const baseline = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 3.25,
        frame_index: 88,
      }, 8000);
      const baselinePixels = assertSnapshotPixels('baseline stage snapshot', baseline);

      const summary = await rpc.send('set_stage3d_scene', {
        stage3d: {
          id: 'native-stage-recording-parity',
          name: 'Native Stage Recording Parity',
          schemaVersion: 1,
          camera: {
            position: [0, 3.4, 10.5],
            target: [0, 2.1, 0],
            fov: 46,
          },
          lighting: {
            roomDarkness: 0,
            screenBoost: 1.4,
            exposure: 1.1,
            roomIntensity: 1,
          },
          atmosphere: {
            haze: false,
            hazeDensity: 0,
          },
          nodes: [
            {
              id: 'native-stage-test-screen',
              type: 'led-screen',
              visible: true,
              position: [0, 2.1, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              width: 10,
              height: 5.6,
              brightness: 2.4,
            },
            {
              id: 'native-stage-test-riser',
              type: 'primitive',
              visible: true,
              position: [0, 0.35, 1.25],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              dimensions: [4.2, 0.7, 2.2],
              geometry: 'box',
              material: {
                color: '#20242c',
                roughness: 0.7,
                metalness: 0,
                emissive: '#38445f',
              },
            },
          ],
          userElements: [
            {
              id: 'native-stage-test-orb',
              type: 'visualsphere',
              position: [0, 1.2, -0.9],
              rotationX: 0,
              rotationY: 0,
              rotationZ: 0,
              scale: 1,
              params: {
                radius: 1.2,
                color: '#ff6a3d',
                brightness: 2.2,
                opacity: 1,
              },
            },
          ],
        },
      }, 5000);
      expect(summary?.screen_count).toBe(1);
      expect(summary?.primitive_count).toBeGreaterThanOrEqual(1);
      expect(summary?.user_element_count).toBe(1);

      const sceneSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 3.25,
        frame_index: 88,
      }, 8000);
      const scenePixels = assertSnapshotPixels('stage scene snapshot', sceneSnapshot);
      expect(sceneSnapshot.dark_frame).toBe(false);
      expect(Number(sceneSnapshot.average_luma ?? 0)).toBeGreaterThan(0.01);
      expect(sceneSnapshot.checksum).not.toBe(baseline.checksum);
      expect(averagePixelDelta(scenePixels, baselinePixels)).toBeGreaterThan(1.5);
    } finally {
      await rpc.close();
    }
  }, 30000);

  itIfNativeCore('captures Projection Sim mesh scenes through the native frame snapshot path', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: {
          backend: nativeBackend,
          width: 128,
          height: 72,
          target_fps: 30,
        },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      const capabilities = await rpc.send('get_capabilities');
      expect(capabilities?.features?.native_projection_sim_output_renderer).toBe(true);
      expect(capabilities?.features?.native_projection_sim_recording_parity).toBe(true);

      const baseline = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 5.5,
        frame_index: 132,
      }, 8000);
      const baselinePixels = assertSnapshotPixels('baseline projection snapshot', baseline);

      const summary = await rpc.send('set_projection_sim_scene', {
        projection_sim: {
          id: 'native-projection-recording-parity',
          name: 'Native Projection Recording Parity',
          schemaVersion: 1,
          environment: {
            background: '#05070b',
            ambient: 0.35,
            roomExposure: 1.2,
            surfaceStyle: 'light-gray',
            floorColor: '#12151a',
            showFloorProjection: true,
            showGrid: false,
            shadows: true,
            shadowStrength: 1,
          },
          camera: {
            position: [7.5, 4.8, 8.5],
            target: [0, 1.7, 0],
            fov: 44,
          },
          objects: [
            {
              id: 'native-projection-test-box',
              name: 'Native Projection Box',
              type: 'primitive',
              primitive: 'box',
              position: [0, 1.4, 0],
              rotation: [0, 0.18, 0],
              scale: [4.6, 2.8, 1.2],
              color: '#26c6ff',
              roughness: 0.5,
              visible: true,
              locked: false,
              castShadow: true,
              receiveProjection: true,
            },
            {
              id: 'native-projection-test-sphere',
              name: 'Native Projection Sphere',
              type: 'primitive',
              primitive: 'sphere',
              position: [-2.6, 1.0, -1.5],
              rotation: [0, 0, 0],
              scale: [1.8, 1.8, 1.8],
              color: '#ff4f93',
              roughness: 0.35,
              visible: true,
              locked: false,
              castShadow: true,
              receiveProjection: false,
            },
          ],
          projectors: [
            {
              id: 'native-projection-test-projector',
              name: 'Native Projector',
              enabled: true,
              locked: false,
              position: [-4.5, 4.2, 6.5],
              target: [0, 1.5, 0],
              fov: 34,
              aspect: 1.7777777778,
              intensity: 1.4,
              opacity: 1,
              color: '#ffffff',
              source: 'master',
              sliceId: null,
              crop: [0, 0, 1, 1],
              edgeBlend: [0, 0, 0, 0],
              showFrustum: true,
            },
          ],
        },
      }, 5000);
      expect(summary?.object_count).toBe(2);
      expect(summary?.primitive_count).toBe(2);
      expect(summary?.projector_count).toBe(1);

      const sceneSnapshot = await rpc.send('frame_snapshot', {
        include_pixels: true,
        time: 5.5,
        frame_index: 132,
      }, 8000);
      const scenePixels = assertSnapshotPixels('projection scene snapshot', sceneSnapshot);
      expect(sceneSnapshot.dark_frame).toBe(false);
      expect(Number(sceneSnapshot.average_luma ?? 0)).toBeGreaterThan(0.01);
      expect(sceneSnapshot.checksum).not.toBe(baseline.checksum);
      expect(averagePixelDelta(scenePixels, baselinePixels)).toBeGreaterThan(1.5);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
