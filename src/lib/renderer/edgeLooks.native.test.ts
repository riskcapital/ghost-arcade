import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdgeEffect, Layer, LayerShape, WarpCorners } from '../types';
import { createDefaultLayerShape } from '../types';
import { buildEdgeEffectContext, nativeEdgeEffectPayload } from '../drawing/edgeEffects';
import { buildLookEffects } from '../looks/edgeLooks';
import { EDGE_LOOKS, edgeLook } from '../looks/edgeLookCatalog';

/**
 * Looks on the native core: six drawn shapes, a Look on all of them, the
 * core's beat clock anchored and the render clock stepped. Checks that every
 * Look draws, that it moves across a beat, that beat-step lights exactly one
 * shape per beat in order, that strobes fire on the beat with no audio, and
 * that a Screen FX tint recolours a layer.
 *
 * With LOOK_THUMBS_OUT=<dir> it also writes the gallery thumbnails: an
 * 8-frame strip per Look over two beats at 120 BPM (public/looks).
 */

const require = createRequire(import.meta.url);
const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';
const THUMBS_OUT = process.env.LOOK_THUMBS_OUT;
const DUMP = process.env.LOOK_DUMP_DIR;
const dump = (name: string, img: Image) => { if (DUMP) { mkdirSync(DUMP, { recursive: true }); writeStrip(join(DUMP, `${name}.png`), [img]); } };

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

interface Image { width: number; height: number; rgba: Uint8Array }

async function snapshot(rpc: NativeRpc): Promise<Image> {
  const frame = await rpc.send('frame_snapshot', { include_pixels: true }, 60000);
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const bgra = String(frame.format).toLowerCase().startsWith('bgra');
  const width = Number(frame.width), height = Number(frame.height);
  // rgba_b64 carries tight rows (padding stripped), whatever padded_bytes_per_row says.
  const row = Math.floor(bytes.length / height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = y * row + x * 4, d = (y * width + x) * 4;
    rgba[d] = bytes[s + (bgra ? 2 : 0)]; rgba[d + 1] = bytes[s + 1]; rgba[d + 2] = bytes[s + (bgra ? 0 : 2)]; rgba[d + 3] = 255;
  }
  return { width, height, rgba };
}

// Six shapes in a 3 x 2 grid (output UV, y up): triangles, diamonds, hexagons.
function shapeFor(i: number): LayerShape {
  const kinds: LayerShape['type'][] = ['triangle', 'polygon', 'rectangle'];
  const shape = createDefaultLayerShape(kinds[i % 3]);
  if (shape.type === 'polygon') shape.params = { ...shape.params, sides: 6 } as any;
  return shape;
}

function cell(i: number): WarpCorners {
  const col = i % 3, row = Math.floor(i / 3);
  const x0 = 0.06 + col * 0.31, x1 = x0 + 0.26;
  const y1 = 0.94 - row * 0.47, y0 = y1 - 0.4;
  return { topLeft: { x: x0, y: y1 }, topRight: { x: x1, y: y1 }, bottomLeft: { x: x0, y: y0 }, bottomRight: { x: x1, y: y0 } };
}

function sixLayers(effectsFor: (i: number) => EdgeEffect[]) {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `look-shape-${i}`,
    layerShape: shapeFor(i),
    corners: cell(i),
    warpMode: 'corners',
    meshGrid: null,
    edgeEffects: { enabled: true, effects: effectsFor(i) },
  }) as unknown as Layer);
}

const TRANSPARENT = Buffer.alloc(64 * 64 * 4).toString('base64');

/** Upload the six layers with their edge payloads (content transparent). */
async function uploadScene(rpc: NativeRpc, layers: Layer[], width: number, height: number, sourceType: 'image' | 'none' = 'image') {
  const bound = sourceType === 'image' && !process.env.LOOK_NO_SOURCE;
  const context = buildEdgeEffectContext(layers as any, width, height);
  const commands: unknown[] = [];
  layers.forEach((layer, index) => {
    const payload = nativeEdgeEffectPayload(layer as any, width, height, context);
    commands.push(
      ...(bound ? [{ type: 'upload_source_frame', source_id: layer.id, width: 64, height: 64, seq: 1, rgba_b64: TRANSPARENT }] : []),
      { type: 'upsert_layer', layer_id: layer.id, opacity: 1, z_index: index, corners: layer.corners, mesh_grid: null },
      bound
        ? { type: 'bind_media_source', layer_id: layer.id, source_id: layer.id, source_type: 'image', uri: `memory://${layer.id}` }
        // What the editor sends for a drawn shape with no content.
        : { type: 'bind_media_source', layer_id: layer.id, source_id: `none:${layer.id}`, source_type: 'none', uri: '' },
      {
        type: 'set_layer_edge_effects', layer_id: layer.id,
        edge_effects: payload?.effects ?? [], edge_outline: payload?.outline ?? [], edge_corners: payload?.corners ?? [],
        edge_diagonals: payload?.diagonals ?? [], edge_geometry: payload?.geometry ?? [0, 0, 0, 0],
        edge_seed: payload?.seed ?? 0, edge_bounds: payload?.bounds ?? [0, 0, 0, 0],
      },
    );
  });
  // Beat 0 at render time 0, 120 BPM: beat = 2 x time.
  commands.push({ type: 'set_beat_clock', beat: 0, bpm: 120, time: 0 }, { type: 'present' });
  await rpc.send('submit_commands', { commands });
}

async function frameAt(rpc: NativeRpc, time: number): Promise<Image> {
  await rpc.send('set_render_clock', { mode: 'manual', time });
  await rpc.send('submit_commands', { commands: [{ type: 'set_render_clock', mode: 'manual', time }, { type: 'present' }] });
  await rpc.send('frame_snapshot', {});
  return snapshot(rpc);
}

async function clearScene(rpc: NativeRpc) {
  const commands = Array.from({ length: 6 }, (_, i) => ({ type: 'remove_layer', layer_id: `look-shape-${i}` }));
  await rpc.send('submit_commands', { commands: [...commands, { type: 'present' }] });
}

/** Mean luma (0-255) of the pixels inside shape i's cell. */
function cellLuma(img: Image, i: number): number {
  const c = cell(i);
  const x0 = Math.floor(c.topLeft.x * img.width), x1 = Math.ceil(c.topRight.x * img.width);
  const y0 = Math.floor((1 - c.topLeft.y) * img.height), y1 = Math.ceil((1 - c.bottomLeft.y) * img.height);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = (y * img.width + x) * 4;
    sum += 0.2126 * img.rgba[p] + 0.7152 * img.rgba[p + 1] + 0.0722 * img.rgba[p + 2];
    n++;
  }
  return sum / Math.max(1, n);
}

const totalLuma = (img: Image) => Array.from({ length: 6 }, (_, i) => cellLuma(img, i)).reduce((a, b) => a + b, 0) / 6;

function meanAbsDiff(a: Image, b: Image): number {
  let sum = 0;
  for (let i = 0; i < a.rgba.length; i += 4) sum += Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
  return sum / (a.width * a.height * 3);
}

function writeStrip(path: string, frames: Image[]) {
  const { PNG } = require('pngjs');
  const w = frames[0].width, h = frames[0].height;
  const png = new PNG({ width: w * frames.length, height: h });
  frames.forEach((frame, f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = (y * w * frames.length + f * w + x) * 4;
      for (let c = 0; c < 4; c++) png.data[d + c] = frame.rgba[s + c];
    }
  });
  writeFileSync(path, PNG.sync.write(png, { colorType: 2 }));
}

function half(img: Image): Image {
  const width = img.width >> 1, height = img.height >> 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      const at = (dx: number, dy: number) => img.rgba[((2 * y + dy) * img.width + 2 * x + dx) * 4 + c];
      rgba[(y * width + x) * 4 + c] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4);
    }
  }
  return { width, height, rgba };
}

const W = 480, H = 270;
/** Beat position b in render seconds at the test's 120 BPM. */
const atBeat = (b: number) => b / 2;

describe('Looks on the native core', () => {
  let rpc: NativeRpc;
  beforeAll(async () => {
    if (!existsSync(nativeCoreBin)) return;
    rpc = createNativeRpc();
    const started = await rpc.send('start', { config: { backend: nativeBackend, width: W, height: H, source_frame_size: 64, target_fps: 30 } }, 30000);
    expect(started?.backend_ready).toBe(true);
    await rpc.send('set_render_clock', { mode: 'manual', time: 0 });
  }, 60000);
  afterAll(() => rpc?.close());

  itIfNativeCore('draws every Look on six shapes and animates it across a beat', async () => {
    for (const look of EDGE_LOOKS) {
      await uploadScene(rpc, sixLayers(() => buildLookEffects(look)), W, H);
      const frames = [];
      for (const b of [0.05, 0.55, 1.05, 1.55]) frames.push(await frameAt(rpc, atBeat(b)));
      const lit = Math.max(...frames.map(totalLuma));
      expect(lit, `${look.id} draws`).toBeGreaterThan(2);
      const motion = Math.max(meanAbsDiff(frames[0], frames[1]), meanAbsDiff(frames[1], frames[2]), meanAbsDiff(frames[0], frames[3]));
      expect(motion, `${look.id} moves`).toBeGreaterThan(0.15);
      if (THUMBS_OUT) {
        mkdirSync(THUMBS_OUT, { recursive: true });
        const strip = [];
        for (let f = 0; f < 8; f++) strip.push(half(await frameAt(rpc, atBeat(0.02 + f * 0.25))));
        writeStrip(join(THUMBS_OUT, `${look.id}.png`), strip);
      }
      await clearScene(rpc);
    }
  }, 600000);

  itIfNativeCore('Beat Step lights one shape per beat, in layer order', async () => {
    await uploadScene(rpc, sixLayers(() => buildLookEffects(edgeLook('beat-step')!)), W, H);
    for (let b = 0; b < 8; b++) {
      const img = await frameAt(rpc, atBeat(b + 0.1));
      dump(`step-${b}`, img);
      const lumas = Array.from({ length: 6 }, (_, i) => cellLuma(img, i));
      const brightest = lumas.indexOf(Math.max(...lumas));
      expect(brightest, `beat ${b}: ${lumas.map((v) => v.toFixed(1)).join(' ')}`).toBe(b % 6);
      const others = lumas.filter((_, i) => i !== brightest);
      expect(Math.max(...others)).toBeLessThan(lumas[brightest] * 0.6);
    }
    await clearScene(rpc);
  }, 120000);

  itIfNativeCore('Kick Strobe flashes on the beat clock when no audio is live', async () => {
    await uploadScene(rpc, sixLayers(() => buildLookEffects(edgeLook('kick-strobe')!)), W, H);
    const onBeat = totalLuma(await frameAt(rpc, atBeat(3.03)));
    const offBeat = totalLuma(await frameAt(rpc, atBeat(3.6)));
    expect(onBeat).toBeGreaterThan(offBeat * 2.5);
    await clearScene(rpc);
  }, 60000);

  itIfNativeCore('draws a Look at full strength on shapes with no source', async () => {
    const look = () => buildLookEffects(edgeLook('beat-step')!);
    await uploadScene(rpc, sixLayers(look), W, H);
    const withSource = cellLuma(await frameAt(rpc, atBeat(6.02)), 0);
    await clearScene(rpc);
    await uploadScene(rpc, sixLayers(look), W, H, 'none');
    const bare = cellLuma(await frameAt(rpc, atBeat(6.02)), 0);
    // The bare shape adds its dim placeholder body; the Look must not be dimmed by it.
    expect(bare).toBeGreaterThan(withSource * 0.9);
    await clearScene(rpc);
  }, 60000);

  itIfNativeCore('a layer tint recolours the layer and its Look', async () => {
    await uploadScene(rpc, sixLayers(() => buildLookEffects(edgeLook('kick-strobe')!, 'neon')), W, H);
    await rpc.send('submit_commands', { commands: [{ type: 'set_layer_tint', layer_id: 'look-shape-0', rgba: [0, 1, 0, 1] }, { type: 'present' }] });
    const img = await frameAt(rpc, atBeat(5.02));
    dump('tint', img);
    const channel = (i: number, c: number) => {
      const x = Math.round((cell(i).topLeft.x + 0.13) * W), y = Math.round((1 - cell(i).topLeft.y + 0.25) * H);
      return img.rgba[(y * W + x) * 4 + c];
    };
    // Neon magenta face: red, no green. Tinted green: its red is gone.
    expect(channel(1, 0)).toBeGreaterThan(150);
    expect(channel(0, 0)).toBeLessThan(40);
    await rpc.send('submit_commands', { commands: [{ type: 'set_layer_tint', layer_id: 'look-shape-0', rgba: [1, 1, 1, 1] }, { type: 'present' }] });
    await clearScene(rpc);
  }, 60000);
});
