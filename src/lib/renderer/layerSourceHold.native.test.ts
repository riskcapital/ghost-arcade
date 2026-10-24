import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Switching a layer to a source that has no picture yet (a p5 page still
 * starting, a shader still compiling, an image still decoding) keeps the
 * layer's previous picture on screen until the new one delivers. Before,
 * the layer drew its loading fill and then nothing, which flashed the
 * layers underneath. A source that never delivers lets go after a while.
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

function solid(rgb: [number, number, number]): string {
  const bytes = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = rgb[0]; bytes[i + 1] = rgb[1]; bytes[i + 2] = rgb[2]; bytes[i + 3] = 255;
  }
  return bytes.toString('base64');
}

const upload = (sourceId: string, rgb: [number, number, number], seq = 1) =>
  ({ type: 'upload_source_frame', source_id: sourceId, width: 16, height: 16, seq, rgba_b64: solid(rgb) });
const bind = (layerId: string, sourceId: string, sourceType = 'image') =>
  ({ type: 'bind_media_source', layer_id: layerId, source_id: sourceId, source_type: sourceType, uri: `memory://${sourceId}` });

/** The composite's centre pixel as [r, g, b]. */
async function centre(rpc: NativeRpc): Promise<[number, number, number]> {
  await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
  const frame = await rpc.send('frame_snapshot', { include_pixels: true }, 30000);
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const width = Number(frame.width);
  const height = Number(frame.height);
  const row = Math.floor(bytes.length / height);
  const p = Math.floor(height / 2) * row + Math.floor(width / 2) * 4;
  const bgra = String(frame.format ?? 'bgra').toLowerCase().startsWith('bgra');
  return [bytes[p + (bgra ? 2 : 0)], bytes[p + 1], bytes[p + (bgra ? 0 : 2)]];
}

const isColour = (px: [number, number, number], rgb: [number, number, number]) =>
  px.every((v, i) => Math.abs(v - rgb[i]) < 40);

const RED: [number, number, number] = [230, 20, 20];
const GREEN: [number, number, number] = [20, 220, 40];
const BLUE: [number, number, number] = [30, 40, 230];

describe('a layer switching source keeps its picture until the new one arrives', () => {
  let rpc: NativeRpc;
  beforeAll(async () => {
    if (!existsSync(nativeCoreBin)) return;
    rpc = createNativeRpc();
    const started = await rpc.send('start', { config: { backend: nativeBackend, width: 96, height: 54, target_fps: 30 } }, 30000);
    expect(started?.backend_ready).toBe(true);
  }, 60000);
  afterAll(() => rpc?.close());

  itIfNativeCore('holds the old picture, swaps on the first frame, and lets go of a source that never comes', async () => {
    // Red underneath, the switching layer on top (z 0 is top-most).
    await rpc.send('submit_commands', {
      commands: [
        upload('under', RED),
        { type: 'upsert_layer', layer_id: 'under', opacity: 1, z_index: 1, corners: FULL, mesh_grid: null },
        bind('under', 'under'),
        upload('sketch-a', GREEN),
        { type: 'upsert_layer', layer_id: 'top', opacity: 1, z_index: 0, corners: FULL, mesh_grid: null },
        bind('top', 'sketch-a'),
      ],
    });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);

    // The next sketch has no frame yet: the first one stays up.
    await rpc.send('submit_commands', { commands: [bind('top', 'sketch-b')] });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);
    const held = await rpc.send('get_layers_snapshot', {});
    const top = (held.layers ?? held).find?.((layer: any) => layer.id === 'top' || layer.layer_id === 'top');
    expect(top?.held_source_id).toBe('sketch-a');

    // Clicking on again before it arrives still holds the first picture.
    await rpc.send('submit_commands', { commands: [bind('top', 'sketch-c')] });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);

    // Its first frame replaces the held picture.
    await rpc.send('submit_commands', { commands: [upload('sketch-c', BLUE)] });
    expect(isColour(await centre(rpc), BLUE)).toBe(true);

    // A shader that has not rendered yet holds the picture too.
    await rpc.send('submit_commands', { commands: [bind('top', 'shader-x', 'shader')] });
    expect(isColour(await centre(rpc), BLUE)).toBe(true);

    // A source that never delivers lets go, so a broken page cannot freeze
    // the old picture on the output.
    await rpc.send('submit_commands', { commands: [bind('top', 'never')] });
    expect(isColour(await centre(rpc), BLUE)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await centre(rpc);
    expect(isColour(await centre(rpc), BLUE)).toBe(false);

    // Clearing the layer shows what is underneath at once.
    await rpc.send('submit_commands', { commands: [upload('sketch-d', GREEN), bind('top', 'sketch-d')] });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);
    await rpc.send('submit_commands', { commands: [bind('top', '', 'none')] });
    expect(isColour(await centre(rpc), GREEN)).toBe(false);
  }, 60000);
});
