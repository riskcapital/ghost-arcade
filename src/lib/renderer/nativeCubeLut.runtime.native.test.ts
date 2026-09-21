import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCubeLut } from '../color/cubeLut';
import { buildNativeCubeLutGraph, buildNativeCubeLutPrecompileCommand } from './nativeCubeLut';
const nativeCoreBin = join(process.cwd(), 'native-renderer/target/release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<string>;
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


const nativeIt = existsSync(nativeCoreBin) ? it : it.skip;
const identityRows = Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n');
const swapRows = Array.from({ length: 8 }, (_, i) => `${(i >> 2) & 1} ${i & 1} ${(i >> 1) & 1}`).join('\n');

describe('Cube LUT on the native GPU', () => {
  nativeIt('renders identity, channel permutation, interpolation, strength and input domains', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: 32, height: 32, source_frame_size: 32, target_fps: 30 } });
      expect(started.backend_ready).toBe(true);
      const compiled = await rpc.send('submit_commands', { commands: [buildNativeCubeLutPrecompileCommand()] });
      expect(compiled.dropped ?? 0).toBe(0);
      let sequence = 1;
      async function render(rows: string, pixel: number[], strength = 1, domain = '', size = 2) {
        const sourceId = `lut-input-${sequence}`;
        const targetSourceId = `lut-output-${sequence}`;
        const rgba = Buffer.from(Array.from({ length: 32 * 32 }, () => pixel).flat());
        await rpc.send('submit_commands', { commands: [{ type: 'upload_source_frame', source_id: sourceId, width: 32, height: 32, rgba_b64: rgba.toString('base64'), seq: sequence }] });
        const lut = parseCubeLut(`${domain}LUT_3D_SIZE ${size}\n${rows}`);
        const result = await rpc.send('compute_graph', buildNativeCubeLutGraph({ lut, sourceId, targetSourceId, strength, seq: sequence++ }));
        expect(result.renders).toHaveLength(1);
        await rpc.send('submit_commands', { commands: [
          { type: 'upsert_layer', layer_id: 'lut-test', z_index: 0, blend_mode: 'normal', opacity: 1, corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
          { type: 'set_layer_visibility', layer_id: 'lut-test', visible: true },
          { type: 'bind_media_source', layer_id: 'lut-test', source_id: targetSourceId, uri: 'lut-test://output', source_type: 'image' },
        ] });
        const snapshot = await rpc.send('frame_snapshot', { include_pixels: true, time: 0, frame_index: sequence });
        expect(snapshot.includes_pixels).toBe(true);
        const data = Buffer.from(snapshot.rgba_b64, 'base64');
        const offset = (16 * Number(snapshot.width) + 16) * 4;
        const pixelOut = Array.from(data.subarray(offset, offset + 4));
        if (String(snapshot.format).toLowerCase().startsWith('bgra')) [pixelOut[0], pixelOut[2]] = [pixelOut[2], pixelOut[0]];
        return pixelOut;
      }
      function near(actual: number[], expected: number[]) {
        expected.forEach((value, i) => expect(Math.abs(actual[i] - value), `channel ${i}: ${actual} expected ${expected}`).toBeLessThanOrEqual(2));
      }
      near(await render(identityRows, [64, 128, 192, 255]), [64, 128, 192, 255]);
      near(await render(swapRows, [255, 0, 0, 255]), [0, 255, 0, 255]);
      near(await render(swapRows, [64, 128, 192, 255]), [192, 64, 128, 255]);
      near(await render(swapRows, [64, 128, 192, 255], 0), [64, 128, 192, 255]);
      near(await render(swapRows, [64, 128, 192, 255], .5), [128, 96, 160, 255]);
      near(await render(identityRows, [64, 128, 192, 255], 1, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 0.5 1 2\n'), [128, 128, 96, 255]);
      near(await render(identityRows, [64, 128, 192, 255], 1, 'LUT_3D_INPUT_RANGE -1e21 1e21\n'), [128, 128, 128, 255]);
      near(await render(identityRows, [255, 128, 0, 255], 1, 'LUT_3D_INPUT_RANGE 0.25 0.75\n'), [255, 129, 0, 255]);
      // Compare composited fractional/zero alpha with the same input at strength zero.
      const transparentBaseline = await render(identityRows, [64, 128, 192, 128], 0);
      near(await render(identityRows, [64, 128, 192, 128]), transparentBaseline);
      const zeroBaseline = await render(identityRows, [255, 0, 0, 0], 0);
      near(await render(swapRows, [255, 0, 0, 0]), zeroBaseline);
      near(await render('0.25 0.5 0.75\n'.repeat(65 ** 3), [255, 0, 0, 255], 1, '', 65), [64, 128, 191, 255]);
      const status = await rpc.send('status');
      expect(status.last_shader_error).toBeNull();
      expect(status.last_frame_error ?? null).toBeNull();
    } finally { await rpc.close(); }
  }, 60000);
});

nativeIt('keeps LUT tables resident across coalesced queues and restores them after cache clearing', async () => {
  const { buildNativeEffectPassChainGraph, buildCompositeEffectPassChainGraph, buildNativeEffectPassPrecompileCommands } = await import('./nativeEffectPass');
  const { cubeLutHandle } = await import('../color/cubeLutAssets');
  const { NativeLutResidency } = await import('./nativeLutResidency');
  const rpc = createNativeRpc();
  try {
    await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: 32, height: 32, source_frame_size: 32, target_fps: 30 } });
    await rpc.send('submit_commands', { commands: buildNativeEffectPassPrecompileCommands() });
    const lut = parseCubeLut(`LUT_3D_SIZE 2\n${swapRows}`);
    const handle = cubeLutHandle(lut);
    const graph = buildNativeEffectPassChainGraph({ sourceId: 'resident-input', targetSourceId: 'resident-output', seq: 1, effects: [{ effect: 'cube-lut', params: { lutHandle: handle, amount: 1 } }] }).config;
    await rpc.send('submit_commands', { commands: [
      { type: 'upload_source_frame', source_id: 'resident-input', width: 32, height: 32, seq: 1, rgba_b64: Buffer.from(Array.from({ length: 1024 }, () => [255, 0, 0, 255]).flat()).toString('base64') },
      { type: 'upsert_layer', layer_id: 'lut-input-carrier', z_index: -1, opacity: 0 },
      { type: 'bind_media_source', layer_id: 'lut-input-carrier', source_id: 'resident-input', uri: 'lut-test://input', source_type: 'image' },
      { type: 'set_layer_visibility', layer_id: 'lut-input-carrier', visible: false },
      { type: 'upsert_layer', layer_id: 'lut-resident', z_index: 0, blend_mode: 'normal', opacity: 1, corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
      { type: 'set_layer_visibility', layer_id: 'lut-resident', visible: true },
      { type: 'bind_media_source', layer_id: 'lut-resident', source_id: 'resident-input', uri: 'lut-test://resident', source_type: 'image' },
    ] });
    const command = { type: 'queue_compute_graph', ...graph };
    const reference = { ...command, buffers: graph.buffers.map(buffer => {
      if (!buffer.immutable_lut) return buffer;
      const { initial_f32: _data, initial_b64: _binary, ...rest } = buffer; return rest;
    }) };
    // Both arrive before presentation: replacing the first queued job must not lose its table upload.
    expect(await center()).toEqual([255, 0, 0, 255]);
    const first = await rpc.send('submit_commands', { commands: [command, reference] });
    expect(first.dropped).toBe(0);
    await expect.poll(async () => {
      await rpc.send('frame_snapshot', { include_pixels: false });
      return (await rpc.send('get_source_frame_readiness', { source_id: 'resident-output' })).ready;
    }, { timeout: 3000, interval: 20 }).toBe(true);
    await rpc.send('submit_commands', { commands: [{ type: 'bind_media_source', layer_id: 'lut-resident', source_id: 'resident-output', uri: 'lut-test://output', source_type: 'image' }] });
    async function center() {
      const snapshot = await rpc.send('frame_snapshot', { include_pixels: true });
      const bytes = Buffer.from(snapshot.rgba_b64, 'base64');
      const pixel = Array.from(bytes.subarray((16 * Number(snapshot.width) + 16) * 4, (16 * Number(snapshot.width) + 16) * 4 + 4));
      if (String(snapshot.format).toLowerCase().startsWith('bgra')) [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      return pixel;
    }
    await expect.poll(center, { timeout: 3000, interval: 20 }).toEqual([0, 255, 0, 255]);
    const cache = new NativeLutResidency();
    cache.prepare([command]).finish(true);
    for (let i = 0; i < 4; i++) {
      const next = cache.prepare([command]);
      expect(JSON.stringify(next.commands).length).toBeLessThan(JSON.stringify([command]).length);
      const result = await rpc.send('submit_commands', { commands: next.commands });
      expect(result.dropped).toBe(0);
      next.finish(true);
      await expect.poll(center, { timeout: 3000, interval: 20 }).toEqual([0, 255, 0, 255]);
    }
    await rpc.send('clear_runtime_caches', { config: { clear_native_graph_buffers: true } });
    const missing = await rpc.send('submit_commands', { commands: [reference] });
    expect(missing.dropped).toBe(1); // Missing assets fail explicitly, never silently initialize to black.
    cache.reset();
    const restored = await rpc.send('submit_commands', { commands: cache.prepare([command]).commands });
    expect(restored.dropped).toBe(0);
    await expect.poll(center, { timeout: 3000, interval: 20 }).toEqual([0, 255, 0, 255]);
    // Post-composite pass uses its own source/target bindings and resident table.
    const composition = buildCompositeEffectPassChainGraph({ sourceId: 'comp-in', targetSourceId: 'comp-out', effects: [{ effect: 'cube-lut', params: { lutHandle: handle, amount: 1 } }] });
    const applied = await rpc.send('submit_commands', { commands: [{ type: 'queue_compute_graph', ...composition.config }] });
    expect(applied.dropped).toBe(0);
    await expect.poll(center, { timeout: 3000, interval: 20 }).toEqual([0, 0, 255, 255]);
  } finally { await rpc.close(); }
}, 60000);
