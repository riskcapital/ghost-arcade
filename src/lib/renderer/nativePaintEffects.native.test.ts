import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildNativeEffectPassGraph, buildNativeEffectPassPrecompileCommands } from './nativeEffectPass';
import { softwareVulkanRunner } from './nativeHardwareTestPlatform';

const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const FULLSCREEN_CORNERS = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const SIZE = 256;
// Set GA_PAINT_SHOTS to a folder to keep the rendered pictures.
const shotDir = process.env.GA_PAINT_SHOTS || '';

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


/** A plain "painting": red above, blue below, with a yellow disc on the join. */
function painting(): Uint8Array {
  const bytes = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const o = (y * SIZE + x) * 4;
    const disc = Math.hypot(x - SIZE * 0.5, y - SIZE * 0.5) < SIZE * 0.14;
    const rgb = disc ? [250, 215, 40] : y < SIZE / 2 ? [225, 45, 35] : [25, 55, 190];
    bytes[o] = rgb[0]; bytes[o + 1] = rgb[1]; bytes[o + 2] = rgb[2]; bytes[o + 3] = 255;
  }
  return bytes;
}

/** Snapshot pixels as RGB rows, top row first. */
function rgbOf(snapshot: any): { width: number; height: number; at(x: number, y: number): [number, number, number] } {
  const data = Buffer.from(String(snapshot.rgba_b64), 'base64');
  const width = Number(snapshot.width), height = Number(snapshot.height);
  expect(data.byteLength).toBe(width * height * 4);
  return { width, height, at: (x, y) => { const o = (y * width + x) * 4; return [data[o + 2], data[o + 1], data[o]]; } };
}

function crcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
}
const CRC = crcTable();
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = 0xffffffff;
  for (const byte of body) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}
function keep(name: string, picture: ReturnType<typeof rgbOf>) {
  if (!shotDir) return;
  mkdirSync(shotDir, { recursive: true });
  const rows = Buffer.alloc((picture.width * 3 + 1) * picture.height);
  for (let y = 0; y < picture.height; y += 1) for (let x = 0; x < picture.width; x += 1) {
    const [r, g, b] = picture.at(x, y); const o = y * (picture.width * 3 + 1) + 1 + x * 3;
    rows[o] = r; rows[o + 1] = g; rows[o + 2] = b;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(picture.width, 0); header.writeUInt32BE(picture.height, 4); header[8] = 8; header[9] = 2;
  writeFileSync(join(shotDir, `${name}.png`), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

const isRed = (c: number[]) => c[0] > 170 && c[1] < 110 && c[2] < 110;
const isBlue = (c: number[]) => c[2] > 140 && c[0] < 90 && c[1] < 110;

describe('Painting effects', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) && !softwareVulkanRunner ? it : it.skip;

  itIfNativeCore('runs paint down the picture and carries colours into each other', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: SIZE, height: SIZE, target_fps: 30 } }, 12000);
      await delay(300);
      const precompiled = await rpc.send('submit_commands', { commands: buildNativeEffectPassPrecompileCommands() }, 8000);
      expect(Number(precompiled?.dropped ?? 0)).toBe(0);
      const sourceId = 'painting-source', layerId = 'painting-layer';
      await rpc.send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: sourceId, width: SIZE, height: SIZE, rgba_b64: Buffer.from(painting()).toString('base64'), seq: 1 },
        { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: 'painting-test://source', source_type: 'image' },
      ] }, 5000);
      const plainShot = await rpc.send('frame_snapshot', { include_pixels: true, time: 0, frame_index: 1 }, 8000);
      const plain = rgbOf(plainShot);
      keep('painting-plain', plain);
      // The picture arrives the right way up: red on top, blue below.
      expect(isRed(plain.at(20, 40))).toBe(true);
      expect(isBlue(plain.at(20, SIZE - 40))).toBe(true);

      let frame = 2;
      let stale = String(plainShot.checksum);
      const render = async (effect: 'paint-drip' | 'ink-flow', time: number, params: Record<string, number>) => {
        const targetSourceId = 'painting-output';
        // The photo is dropped once no layer shows it, so hand it over again for each render.
        await rpc.send('submit_commands', { commands: [{ type: 'upload_source_frame', source_id: sourceId, width: SIZE, height: SIZE, rgba_b64: Buffer.from(painting()).toString('base64'), seq: frame }] }, 5000);
        const graph = buildNativeEffectPassGraph({ sourceId, targetSourceId, effect, width: SIZE, height: SIZE, time, frameDelta: 1 / 30, frameIndex: frame, mix: 1, params });
        const result = await rpc.send('compute_graph', graph.config, 8000);
        expect(result?.render).toMatchObject({ target: 'source_frame', source_id: targetSourceId });
        await rpc.send('submit_commands', { commands: [{ type: 'bind_media_source', layer_id: layerId, source_id: targetSourceId, uri: `painting-test://${targetSourceId}`, source_type: 'image' }] }, 5000);
        const deadline = Date.now() + 20000;
        let shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000);
        while (shot.checksum === stale && Date.now() < deadline) { await delay(25); shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000); }
        stale = String(shot.checksum);
        frame += 1;
        return rgbOf(shot);
      };

      // Paint Drip: red runs down into the blue; nothing runs up into the red.
      const drip = await render('paint-drip', 4, { dripLength: 0.6, dripColumns: 16, dripSpeed: 0.6, dripWobble: 0.3, dripGloss: 0, dripStreak: 0.5 });
      keep('painting-drip', drip);
      let ranDown = 0, ranUp = 0;
      for (let x = 0; x < SIZE; x += 1) {
        if (Math.abs(x - SIZE / 2) < SIZE * 0.2) continue; // keep clear of the disc
        for (let y = SIZE / 2 + 6; y < SIZE - 4; y += 1) if (isRed(drip.at(x, y))) ranDown += 1;
        for (let y = 4; y < SIZE / 2 - 6; y += 1) if (isBlue(drip.at(x, y))) ranUp += 1;
      }
      expect(ranDown).toBeGreaterThan(400);
      expect(ranUp).toBe(0);
      // Length 0 leaves the picture alone.
      const dry = await render('paint-drip', 4, { dripLength: 0, dripGloss: 0 });
      let moved = 0;
      for (let y = 0; y < SIZE; y += 8) for (let x = 0; x < SIZE; x += 8) { const a = dry.at(x, y), b = plain.at(x, y); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 12) moved += 1; }
      expect(moved).toBe(0);
      const later = await render('paint-drip', 9, { dripLength: 0.6, dripColumns: 16, dripSpeed: 0.6, dripWobble: 0.3, dripGloss: 0, dripStreak: 0.5 });
      keep('painting-drip-later', later);

      // Ink Flow: where red met blue there is now a wide band that is neither.
      const mixedIn = (picture: ReturnType<typeof rgbOf>) => {
        let count = 0;
        for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
          if (Math.abs(x - SIZE / 2) < SIZE * 0.2) continue;
          const c = picture.at(x, y);
          if (!isRed(c) && !isBlue(c)) count += 1;
        }
        return count;
      };
      const ink = await render('ink-flow', 3, { inkAmount: 0.7, inkScale: 3, inkSpeed: 0.5, inkAngle: 90, inkStream: 0.4, inkBleed: 0.7, inkPigment: 0.5, inkMix: 1 });
      keep('painting-ink', ink);
      expect(mixedIn(plain)).toBeLessThan(600);
      expect(mixedIn(ink)).toBeGreaterThan(4000);
      // It moves: a later moment is a different picture.
      const inkLater = await render('ink-flow', 6, { inkAmount: 0.7, inkScale: 3, inkSpeed: 0.5, inkAngle: 90, inkStream: 0.4, inkBleed: 0.7, inkPigment: 0.5, inkMix: 1 });
      keep('painting-ink-later', inkLater);
      let changed = 0;
      for (let y = 0; y < SIZE; y += 4) for (let x = 0; x < SIZE; x += 4) { const a = ink.at(x, y), b = inkLater.at(x, y); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 24) changed += 1; }
      expect(changed).toBeGreaterThan(200);
      // Run 0 leaves the picture alone.
      const still = await render('ink-flow', 3, { inkAmount: 0, inkPigment: 0 });
      let stirred = 0;
      for (let y = 0; y < SIZE; y += 8) for (let x = 0; x < SIZE; x += 8) { const a = still.at(x, y), b = plain.at(x, y); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 12) stirred += 1; }
      expect(stirred).toBe(0);
    } finally {
      const log = await rpc.close();
      if (process.env.GA_PAINT_LOG) console.log(String(log).slice(-3000));
    }
  }, 90000);
});
