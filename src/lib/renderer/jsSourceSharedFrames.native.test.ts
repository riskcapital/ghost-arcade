import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Three.js / p5 hosts can send their frames as shared textures
 * (GA_JS_HOST_SHARED_TEXTURE=1). A frame the core cannot open must say so in
 * the submit answer, so the host goes back to bitmaps instead of the layer
 * freezing on its last picture; the capability tells the host it may rely
 * on that.
 */

const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';

type NativeRpc = { send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): void };

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let buffer = '';
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        const wait = pending.get(message.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id);
          if (message.ok) wait.resolve(message.result); else wait.reject(new Error(message.error || 'native rpc error'));
        }
      } catch { /* log line */ }
      index = buffer.indexOf('\n');
    }
  });
  return {
    send(method, params = {}, timeoutMs = 30000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`native rpc timeout: ${method}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    close() {
      for (const wait of pending.values()) clearTimeout(wait.timer);
      child.kill();
    },
  };
}

const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

describe('shared-texture source frames the core cannot open', () => {
  let rpc: NativeRpc;
  beforeAll(async () => {
    if (!existsSync(nativeCoreBin)) return;
    rpc = createNativeRpc();
    const started = await rpc.send('start', { config: { backend: nativeBackend, width: 96, height: 54, target_fps: 30 } }, 30000);
    expect(started?.backend_ready).toBe(true);
  }, 60000);
  afterAll(() => rpc?.close());

  itIfNativeCore('advertises that it reports them', async () => {
    const capabilities = await rpc.send('get_capabilities');
    expect(capabilities?.features?.shared_texture_source_frame_errors).toBe(true);
  });

  itIfNativeCore('answers an unknown IOSurface with an error and drops the frame', async () => {
    if (process.platform !== 'darwin') return;
    const result = await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'js', opacity: 1, z_index: 0, corners: FULL, mesh_grid: null },
        {
          type: 'upload_source_frame',
          source_id: 'js-host',
          seq: 1,
          width: 64,
          height: 36,
          // No surface has this ID.
          shared_handle: '4294967000',
          shared_texture_platform: 'iosurface',
          shared_texture_format: 'bgra8unorm',
          shared_texture_handle_encoding: 'integer',
        },
      ],
    });
    expect(result.applied).toBe(1);
    expect(result.dropped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe('upload_source_frame');
    expect(String(result.errors[0].message)).toContain('IOSurfaceLookup');
  });

  itIfNativeCore('answers a frame it took without errors', async () => {
    const bytes = Buffer.alloc(16 * 16 * 4, 200).toString('base64');
    const result = await rpc.send('submit_commands', {
      commands: [{ type: 'upload_source_frame', source_id: 'js-host', seq: 2, width: 16, height: 16, rgba_b64: bytes }],
    });
    expect(result.dropped).toBe(0);
    expect(result.errors).toEqual([]);
  });
});
