import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { TextContent } from '$lib/types';
import { softwareVulkanRunner } from './nativeHardwareTestPlatform';
import {
  buildTextNativeComputeGraph, buildTextNativePrecompileCommands, textNativeAtlasSourceId,
  type TextGlyphMetric, type TextNativeAtlas,
} from './textNative';

const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const FULLSCREEN_CORNERS = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const W = 480, H = 270;
// Set GA_TEXT_SHOTS to a folder to keep the rendered pictures.
const shotDir = process.env.GA_TEXT_SHOTS || '';

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<string>;
};
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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


function rgbOf(snapshot: any): { width: number; height: number; at(x: number, y: number): [number, number, number] } {
  const data = Buffer.from(String(snapshot.rgba_b64), 'base64');
  const width = Number(snapshot.width), height = Number(snapshot.height);
  expect(data.byteLength).toBe(width * height * 4);
  return { width, height, at: (x, y) => { const o = (y * width + x) * 4; return [data[o + 2], data[o + 1], data[o]]; } };
}

// A stand-in font: every letter is a solid block, so the test needs no browser canvas. The
// shader, the tiling and the motion are what is under test, not letter shapes.
const TEXT = 'GHOSTS';
const CELL_W = 20, CELL_H = 28, ADVANCE = 24;
function blockAtlas(): TextNativeAtlas {
  const size = 128;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const cells = new Map<string, { x: number; y: number; w: number; h: number; penX: number; penY: number; advance: number }>();
  [...new Set([...TEXT])].forEach((char, i) => {
    const x = 4 + i * (CELL_W + 6), y = 4;
    for (let yy = y; yy < y + CELL_H; yy += 1) for (let xx = x; xx < x + CELL_W; xx += 1) { const o = (yy * size + xx) * 4; rgba[o] = 255; rgba[o + 3] = 255; }
    cells.set(char, { x, y, w: CELL_W, h: CELL_H, penX: 0, penY: CELL_H, advance: ADVANCE });
  });
  return { signature: 'blocks', width: size, height: size, rgba, cells, rasterScale: 1, rasterFontSize: CELL_H };
}
function letters(): TextGlyphMetric[] {
  const start = (W - TEXT.length * ADVANCE) / 2;
  return [...TEXT].map((char, index) => ({ char, x: start + index * ADVANCE, y: H / 2 + CELL_H / 2, width: ADVANCE, index, lineIndex: 0 }));
}
const base = {
  text: TEXT, fontFamily: 'Inter', fontSize: CELL_H, fontWeight: 700, fontStyle: 'normal',
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, alignment: 'center', letterSpacing: 0, lineHeight: 1.2,
  backgroundColor: 'transparent', shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  animation: { type: 'none', speed: 1, loop: true, direction: 'forward', staggerDelay: 0.05, intensity: 1 },
  enable3D: false, extrudeDepth: 0, extrudeColor: '#000000', rotateX: 0, rotateY: 0, rotateZ: 0,
  lightAngle: 0, lightIntensity: 0, bevelSize: 0,
} as unknown as TextContent;

type Lit = { count: number; minX: number; maxX: number; minY: number; maxY: number; cells(cols: number, rows: number): number[] };
function litOf(picture: ReturnType<typeof rgbOf>): Lit {
  let count = 0, minX = picture.width, maxX = -1, minY = picture.height, maxY = -1;
  const points: [number, number][] = [];
  for (let y = 0; y < picture.height; y += 1) for (let x = 0; x < picture.width; x += 1) {
    if (picture.at(x, y)[0] > 120) { count += 1; points.push([x, y]); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return {
    count, minX, maxX, minY, maxY,
    cells: (cols, rows) => {
      const out = new Array(cols * rows).fill(0);
      for (const [x, y] of points) out[Math.min(rows - 1, Math.floor((y / picture.height) * rows)) * cols + Math.min(cols - 1, Math.floor((x / picture.width) * cols))] += 1;
      return out;
    },
  };
}

describe('Text tiling and motion on the GPU', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) && !softwareVulkanRunner ? it : it.skip;

  itIfNativeCore('repeats the text across the frame in each tile style and draws the new motion', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: W, height: H, target_fps: 30 } }, 12000);
      await delay(300);
      const precompiled = await rpc.send('submit_commands', { commands: buildTextNativePrecompileCommands() }, 8000);
      expect(Number(precompiled?.dropped ?? 0)).toBe(0);
      const sourceId = 'text-test', layerId = 'text-layer';
      const atlas = blockAtlas();
      const atlasSourceId = textNativeAtlasSourceId(sourceId);
      await rpc.send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: atlasSourceId, width: atlas.width, height: atlas.height, rgba_b64: Buffer.from(atlas.rgba).toString('base64'), seq: 1 },
        { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      ] }, 5000);

      let frame = 2;
      let stale = '';
      const render = async (name: string, content: Partial<TextContent>, time = 0.4, clockTime = time) => {
        const graph = buildTextNativeComputeGraph({ sourceId, atlasSourceId, content: { ...base, ...content } as TextContent, atlas, letters: letters(), width: W, height: H, time, clockTime, frameDelta: 1 / 30, frameIndex: frame });
        const result = await rpc.send('compute_graph', graph.config, 8000);
        expect(result?.render).toMatchObject({ target: 'source_frame', source_id: sourceId });
        await rpc.send('submit_commands', { commands: [{ type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: `text-test://${frame}`, source_type: 'image' }] }, 5000);
        const deadline = Date.now() + 20000;
        let shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000);
        while (shot.checksum === stale && Date.now() < deadline) { await delay(25); shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000); }
        stale = String(shot.checksum);
        frame += 1;
        const picture = rgbOf(shot);
        keep(name, picture);
        return litOf(picture);
      };
      const tile = (style: string, extra = {}) => ({ tile: { enabled: true, columns: 3, rows: 3, style, scale: 1, speed: 0.5, variation: 1, ...extra } }) as Partial<TextContent>;

      // One block of text, centred.
      const plain = await render('text-plain', {});
      expect(plain.count).toBeGreaterThan(TEXT.length * CELL_W * CELL_H * 0.8);
      expect(plain.cells(3, 3).filter(n => n > 0).length).toBe(1);

      // Grid: the same block in all nine cells, each fitted to its cell, so every cell holds the same ink.
      const grid = await render('text-tile-grid', tile('grid'));
      const perCell = grid.cells(3, 3);
      expect(perCell.every(n => n > 0)).toBe(true);
      const mean = perCell.reduce((a, b) => a + b, 0) / 9;
      for (const n of perCell) expect(Math.abs(n - mean)).toBeLessThan(mean * 0.08);
      // The block fills most of a cell's width instead of a ninth of the frame's.
      expect(grid.maxX - grid.minX).toBeGreaterThan(W * 0.9);

      // Brick: alternate rows sit half a tile across, so the middle row reaches the frame edges.
      const brick = await render('text-tile-brick', tile('brick'));
      expect(brick.minX).toBeLessThan(grid.minX - 10);

      // Sizes: tiles differ in size, so cells no longer hold equal ink.
      const sizes = (await render('text-tile-sizes', tile('sizes'))).cells(3, 3);
      expect(Math.max(...sizes) / Math.max(1, Math.min(...sizes))).toBeGreaterThan(1.8);

      // Vertical: some tiles stand on end, so ink reaches further up and down than the grid's rows.
      const vertical = await render('text-tile-vertical', tile('vertical'));
      expect(vertical.maxY - vertical.minY).toBeGreaterThan(grid.maxY - grid.minY + 8);

      // Scroll: rows move with the layer clock, not with the letter animation's clock.
      const scrollA = await render('text-tile-scroll-a', tile('scroll'), 0.4, 0.2);
      const scrollB = await render('text-tile-scroll-b', tile('scroll'), 0.4, 0.9);
      expect(scrollA.cells(12, 3).join()).not.toBe(scrollB.cells(12, 3).join());

      await render('text-tile-flip', tile('flip'));
      await render('text-tile-steps', tile('steps'), 0.4, 1.3);
      const mix = await render('text-tile-mix', tile('mix', { columns: 5, rows: 5 }));
      expect(mix.count).toBeGreaterThan(0);

      // A turned-off tile setting leaves the single block alone.
      const off = await render('text-tile-off', { tile: { enabled: false, columns: 4, rows: 4, style: 'grid', scale: 1, speed: 1, variation: 1 } } as Partial<TextContent>);
      expect(Math.abs(off.count - plain.count)).toBeLessThan(plain.count * 0.02);

      // Motion: a width wave makes the line wider than it is at rest; tall stretch makes it taller.
      const anim = (type: string) => ({ animation: { ...base.animation, type } }) as Partial<TextContent>;
      const stretch = await render('text-stretch-wave', anim('stretchWave'), 0.4);
      expect(stretch.maxX - stretch.minX).toBeGreaterThan((plain.maxX - plain.minX) * 1.25);
      const tall = await render('text-tall-stretch', anim('tallStretch'), 0.3);
      expect(tall.maxY - tall.minY).toBeGreaterThan((plain.maxY - plain.minY) * 1.6);
      expect(Math.abs(tall.maxY - plain.maxY)).toBeLessThan(3);
      for (const type of ['elasticWide', 'trackingBreathe', 'slam', 'drumRoll', 'echoStack', 'riseStagger', 'orbit', 'sizeCascade']) {
        const shown = await render(`text-${type}`, anim(type), 1.1);
        expect(shown.count, type).toBeGreaterThan(50);
      }
      // Tiled and animated together.
      const both = await render('text-tile-with-motion', { ...tile('brick', { columns: 4, rows: 4 }), ...anim('stretchWave') }, 0.4);
      expect(both.cells(4, 4).filter(n => n > 0).length).toBe(16);
    } finally {
      await rpc.close();
    }
  }, 120000);
});
