// Native render-core contract for recording a single source: the record
// target (one layer, with or without transparency) and a Screen's slice
// output, both read back through export_frame_snapshot the way the live
// recorder reads their shared textures.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);
const sharedTexturePlatform = process.platform === 'darwin' || process.platform === 'win32';
const itIfNativeCore = existsSync(nativeCoreBin) && sharedTexturePlatform ? it : it.skip;
const backend = process.platform === 'darwin' ? 'metal' : 'd3d12';

function createNativeRpc() {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
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
          else wait.reject(new Error(message.error));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 10000) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr.trim()}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already gone */ }
      child.kill();
    },
  };
}

const corners = (x0: number, x1: number) => ({
  topLeft: { x: x0, y: 0 },
  topRight: { x: x1, y: 0 },
  bottomRight: { x: x1, y: 1 },
  bottomLeft: { x: x0, y: 1 },
});

type Frame = { pixels: Buffer; width: number; height: number };

async function readExport(rpc: ReturnType<typeof createNativeRpc>, dir: string, source: string, name: string): Promise<Frame> {
  const path = join(dir, `${name}.raw`);
  // Each capture reads what the last frame rendered; poll until the target
  // exists and has drawn at least once.
  const deadline = Date.now() + 5000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await rpc.send('export_frame_snapshot', { source, path }, 10000);
      return { pixels: readFileSync(path), width: Number(result.width), height: Number(result.height) };
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

/** BGRA pixel at a fraction of the frame. */
function pixel(frame: Frame, xRatio: number, yRatio = 0.5) {
  const x = Math.round((frame.width - 1) * xRatio);
  const y = Math.round((frame.height - 1) * yRatio);
  const o = (y * frame.width + x) * 4;
  return { b: frame.pixels[o], g: frame.pixels[o + 1], r: frame.pixels[o + 2], a: frame.pixels[o + 3] };
}

describe('native record target', () => {
  itIfNativeCore('records one layer with straight alpha, over black without it, and a Screen output', async () => {
    const rpc = createNativeRpc();
    const dir = mkdtempSync(join(tmpdir(), 'ga-record-target-'));
    try {
      await rpc.send('start', { config: { backend, width: 128, height: 72, target_fps: 30 } }, 15000);
      await rpc.send('submit_commands', {
        commands: [
          // Green across the whole frame underneath, red on the left half on top.
          { type: 'upsert_layer', layer_id: 'under', z_index: 1, opacity: 1, blend_mode: 'normal', corners: corners(0, 1) },
          { type: 'set_layer_visibility', layer_id: 'under', visible: true },
          { type: 'set_layer_color', layer_id: 'under', rgba: [0, 1, 0, 1] },
          { type: 'upsert_layer', layer_id: 'solo', z_index: 0, opacity: 1, blend_mode: 'add', corners: corners(0, 0.5), vj_layer_index: 2 },
          { type: 'set_layer_visibility', layer_id: 'solo', visible: true },
          { type: 'set_layer_color', layer_id: 'solo', rgba: [1, 0, 0, 1] },
          { type: 'present' },
        ],
      }, 10000);

      const state = await rpc.send('set_record_target', { kind: 'layer', layer_id: 'solo', alpha: true });
      expect(state.kind).toBe('layer');
      expect(state.layer_count).toBe(1);
      await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
      const alpha = await readExport(rpc, dir, 'record_target', 'alpha');
      expect(alpha.width).toBe(128);
      expect(alpha.height).toBe(72);
      const inside = pixel(alpha, 0.25);
      const outside = pixel(alpha, 0.75);
      // Only the recorded layer: its red, never the green layer below it.
      expect(outside.a, 'empty region is transparent').toBe(0);
      expect(inside.a, 'layer region carries its coverage').toBeGreaterThan(100);
      expect(inside.r, 'straight colour, not darkened by coverage').toBeGreaterThan(240);
      expect(inside.g, 'the layer below is not recorded').toBeLessThan(10);
      const tracked = await rpc.send('record_target_state', {});
      expect(tracked.available).toBe(true);
      expect(tracked.alpha).toBe(true);

      // Same layer without alpha: over black, opaque, premultiplied colour.
      await rpc.send('set_record_target', { kind: 'vj_layer', vj_layer_index: 2, alpha: false });
      await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
      await new Promise(resolve => setTimeout(resolve, 150));
      const opaque = await readExport(rpc, dir, 'record_target', 'opaque');
      expect(pixel(opaque, 0.75)).toMatchObject({ r: 0, g: 0, b: 0, a: 255 });
      expect(pixel(opaque, 0.25).a).toBe(255);
      expect(pixel(opaque, 0.25).r).toBeGreaterThan(100);
      expect(pixel(opaque, 0.25).g).toBeLessThan(10);

      // Clearing releases the target.
      const cleared = await rpc.send('set_record_target', { kind: 'none' });
      expect(cleared).toMatchObject({ available: false, kind: 'none' });

      // Two Screens cropping different halves: each export is its own crop.
      await rpc.send('submit_commands', {
        commands: [
          { type: 'set_slice_outputs', slices: [
            { id: 'screen-1', width: 64, height: 72, cropX: 0, cropW: 0.5 },
            { id: 'screen-2', width: 64, height: 72, cropX: 0.5, cropW: 0.5 },
          ] },
          { type: 'present' },
        ],
      });
      const screen1 = await readExport(rpc, dir, 'slice:screen-1', 'screen-1');
      const screen2 = await readExport(rpc, dir, 'slice:screen-2', 'screen-2');
      expect(screen2.width).toBe(64);
      // Screen 1 shows the red layer (added over green); Screen 2 only green.
      expect(pixel(screen1, 0.5).r).toBeGreaterThan(100);
      expect(pixel(screen2, 0.5).r).toBeLessThan(10);
      expect(pixel(screen2, 0.5).g).toBeGreaterThan(100);
      await expect(rpc.send('export_frame_snapshot', { source: 'slice:missing', path: join(dir, 'x.raw') }))
        .rejects.toThrow(/not rendering/);
    } finally {
      await rpc.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it('rejects malformed record targets', async () => {
    if (!existsSync(nativeCoreBin)) return;
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', { config: { backend, width: 64, height: 36, target_fps: 30 } }, 15000);
      await expect(rpc.send('set_record_target', { kind: 'layer' })).rejects.toThrow(/layer_id/);
      await expect(rpc.send('set_record_target', { kind: 'bogus' })).rejects.toThrow(/unknown/);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
