import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { phoneFeedCoreSourceId, phoneFeedCoreUri } from '../mobile/phoneFeeds';

/**
 * A phone camera / depth feed in the real render core, as the desktop sends
 * it (src/lib/mobile/phoneFeedPump.ts): frames uploaded under the feed's own
 * source id, written into the slot as sent; every layer bound to the feed
 * shows it; the core reports it ready (what makes the phone say "live on the
 * desktop"); and when the phone goes, a see-through frame lets go of the
 * picture so no cell keeps a frozen one.
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

/** A phone frame: a picture of its own shape, placed in the slot as sent. */
function feedFrame(rgb: [number, number, number], seq: number, width = 64, height = 24) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) { bytes[i] = rgb[0]; bytes[i + 1] = rgb[1]; bytes[i + 2] = rgb[2]; bytes[i + 3] = 255; }
  return { type: 'upload_source_frame', source_id: FEED, width, height, seq, rgba_b64: bytes.toString('base64'), placement: 'rect' };
}
const blank = (seq: number) => ({ type: 'upload_source_frame', source_id: FEED, width: 2, height: 2, seq, rgba_b64: Buffer.alloc(16).toString('base64'), placement: 'rect' });
const FEED = phoneFeedCoreSourceId('dual');
const bindFeed = (layerId: string) => ({ type: 'bind_media_source', layer_id: layerId, source_id: FEED, source_type: 'image', uri: phoneFeedCoreUri('dual') });

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

describe('a phone feed in the render core', () => {
  let rpc: NativeRpc;
  beforeAll(async () => {
    if (!existsSync(nativeCoreBin)) return;
    rpc = createNativeRpc();
    const started = await rpc.send('start', { config: { backend: nativeBackend, width: 96, height: 54, target_fps: 30 } }, 30000);
    expect(started?.backend_ready).toBe(true);
  }, 60000);
  afterAll(() => rpc?.close());

  itIfNativeCore('shows the feed on the layers bound to it, reports it ready, and lets go when the phone goes', async () => {
    await rpc.send('submit_commands', {
      commands: [
        upload('under', RED),
        { type: 'upsert_layer', layer_id: 'under', opacity: 1, z_index: 1, corners: FULL, mesh_grid: null },
        bind('under', 'under'),
        { type: 'upsert_layer', layer_id: 'cell', opacity: 1, z_index: 0, corners: FULL, mesh_grid: null },
        bindFeed('cell'),
      ],
    });
    // No frame yet: nothing on top of the layer underneath, and not ready.
    expect((await rpc.send('get_source_frame_readiness', { source_id: FEED })).ready).toBe(false);
    // With no frame at all the core draws its waiting card over the layer underneath...
    expect(isColour(await centre(rpc), RED)).toBe(false);
    // ...so a cell whose phone is not connected gets a see-through frame first (the sync primes it).
    const seq = 1_700_000_000_000;
    await rpc.send('submit_commands', { commands: [blank(seq - 1)] });
    expect(isColour(await centre(rpc), RED)).toBe(true);

    await rpc.send('submit_commands', { commands: [feedFrame(GREEN, seq)] });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);
    expect((await rpc.send('get_source_frame_readiness', { source_id: FEED })).ready).toBe(true);

    // Newer frames replace it; a stale one (lower sequence) never does.
    await rpc.send('submit_commands', { commands: [feedFrame(BLUE, seq + 1)] });
    expect(isColour(await centre(rpc), BLUE)).toBe(true);
    await rpc.send('submit_commands', { commands: [feedFrame(GREEN, seq)] });
    expect(isColour(await centre(rpc), BLUE)).toBe(true);

    // The phone went: the see-through frame shows what is underneath, not a frozen picture.
    await rpc.send('submit_commands', { commands: [blank(seq + 2)] });
    expect(isColour(await centre(rpc), RED)).toBe(true);

    // It came back (a new session of the same feed): the same layer shows it with no rebind.
    await rpc.send('submit_commands', { commands: [feedFrame(GREEN, seq + 3)] });
    expect(isColour(await centre(rpc), GREEN)).toBe(true);
  }, 60000);
});
