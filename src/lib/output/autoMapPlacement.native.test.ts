import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rpcDeadlineScale } from '../renderer/nativeHardwareTestPlatform';
import { rasterToComposition, type OutputPath, type UV } from './autoMapPlacement';

/**
 * The phone measures a surface in the projector's raster; the layer pinned to
 * it is placed in the composition through rasterToComposition. On the native
 * core, a full-frame picture whose colour names its own position is sent
 * through a Screen (crop, rotation, corner warp, Master Warp): every raster
 * point must show the composition point rasterToComposition says it does. The
 * main output runs the same output stage (fs_output, output_source_uv) with
 * its own crop and rotation; its window is not readable here.
 */
const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';
const SIZE = 256, SOURCE = 64, SLICE = { width: 320, height: 200 };

function rpc() {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1, buffer = '';
  const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      try { const m = JSON.parse(line); const w = pending.get(m.id); if (w) { pending.delete(m.id); m.ok ? w.resolve(m.result) : w.reject(new Error(m.error)); } } catch { /* log line */ }
    }
  });
  return {
    send: (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`); }),
    close: () => { child.kill(); },
  };
}

/** Red = x across the composition, green = y down it. */
function positionFrame(): string {
  const bytes: number[] = [];
  for (let y = 0; y < SOURCE; y++) for (let x = 0; x < SOURCE; x++) bytes.push(Math.round(((x + 0.5) / SOURCE) * 255), Math.round(((y + 0.5) / SOURCE) * 255), 200, 255);
  return Buffer.from(bytes).toString('base64');
}
type Shot = { width: number; height: number; bytes: Buffer; stride: number; red: number; green: number; blue: number };
function shotOf(frame: any): Shot {
  const bgra = String(frame.format ?? '').toLowerCase().startsWith('bgra');
  const bytes = Buffer.from(frame.rgba_b64, 'base64'), width = Number(frame.width), height = Number(frame.height);
  const stride = bytes.length === width * 4 * height ? width * 4 : Number(frame.padded_bytes_per_row ?? width * 4);
  return { width, height, bytes, stride, red: bgra ? 2 : 0, green: 1, blue: bgra ? 0 : 2 };
}
/** The composition point (layer coordinates, y up) a raster point shows, or null where it shows nothing. */
function seen(shot: Shot, p: UV): UV | null {
  const px = Math.min(shot.width - 1, Math.floor(p.x * shot.width)), py = Math.min(shot.height - 1, Math.floor(p.y * shot.height));
  const at = py * shot.stride + px * 4;
  if (shot.bytes[at + shot.blue] < 120) return null;
  return { x: shot.bytes[at + shot.red] / 255, y: 1 - shot.bytes[at + shot.green] / 255 };
}
const flipCorners = (c: any) => ({ topLeft: { x: c.bottomLeft.x, y: 1 - c.bottomLeft.y }, topRight: { x: c.bottomRight.x, y: 1 - c.bottomRight.y }, bottomLeft: { x: c.topLeft.x, y: 1 - c.topLeft.y }, bottomRight: { x: c.topRight.x, y: 1 - c.topRight.y } });
const PROBES: UV[] = [];
for (const y of [0.15, 0.4, 0.65, 0.85]) for (const x of [0.12, 0.37, 0.62, 0.88]) PROBES.push({ x, y });

async function setup(core: ReturnType<typeof rpc>) {
  const started = await core.send('start', { config: { backend: nativeBackend, width: SIZE, height: SIZE, source_frame_size: SOURCE, target_fps: 30 } });
  expect(started?.backend_ready).toBe(true);
  await core.send('submit_commands', { commands: [
    { type: 'upload_source_frame', source_id: 'pos', width: SOURCE, height: SOURCE, seq: 1, rgba_b64: positionFrame() },
    { type: 'upsert_layer', layer_id: 'full', opacity: 1, z_index: 0, corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
    { type: 'bind_media_source', layer_id: 'full', source_id: 'pos', source_type: 'image', uri: 'memory://pos' },
    { type: 'present' },
  ] });
}
function compare(shot: Shot, path: OutputPath, label: string) {
  let compared = 0;
  for (const p of PROBES) {
    const want = rasterToComposition(p, path), got = seen(shot, p);
    if (!want || !got) { expect(!!want, `${label}: ${JSON.stringify(p)} shows ${got ? 'the picture' : 'nothing'}`).toBe(!!got); continue; }
    expect(Math.hypot(want.x - got.x, want.y - got.y), `${label}: raster ${p.x},${p.y} shows ${got.x.toFixed(3)},${got.y.toFixed(3)}, placed at ${want.x.toFixed(3)},${want.y.toFixed(3)}`).toBeLessThan(0.035);
    compared++;
  }
  expect(compared).toBeGreaterThan(6);
}

describe('auto-map surfaces through the output stage on the native core', () => {
  const cases: [string, OutputPath][] = [
    ['crop', { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } }],
    ['crop, turned 90', { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, rotation: 90 }],
    ['crop, turned 180', { crop: { x: 0.1, y: 0.3, w: 0.7, h: 0.5 }, rotation: 180 }],
    ['crop, turned 270', { crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, rotation: 270 }],
    ['corner warp', { crop: { x: 0, y: 0, w: 1, h: 1 }, warpMode: 'corners', corners: { topLeft: { x: 0.1, y: 0.05 }, topRight: { x: 0.8, y: 0.15 }, bottomRight: { x: 0.9, y: 0.9 }, bottomLeft: { x: 0.05, y: 0.7 } } }],
    ['crop under a Master Warp', { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, rotation: 90, masterWarp: { enabled: true, mode: 'corners', corners: { topLeft: { x: 0.05, y: 0.1 }, topRight: { x: 0.95, y: 0 }, bottomRight: { x: 1, y: 0.95 }, bottomLeft: { x: 0, y: 1 } } } }],
  ];
  for (const [label, path] of cases) itIfNativeCore(`a Screen: ${label}`, async () => {
    const core = rpc();
    try {
      await setup(core);
      if (path.masterWarp) await core.send('submit_commands', { commands: [{ type: 'set_output_stage', masterWarp: { enabled: true, mode: 'corners', corners: flipCorners(path.masterWarp.corners) } }] });
      const c = path.crop;
      await core.send('set_slice_outputs', { slices: [{ id: 'a', width: SLICE.width, height: SLICE.height, cropX: c.x, cropY: 1 - c.y - c.h, cropW: c.w, cropH: c.h, rotation: path.rotation ?? 0, warpMode: path.warpMode ?? 'rect', ...(path.corners ? { corners: flipCorners(path.corners) } : {}) }] });
      await core.send('submit_commands', { commands: [{ type: 'present' }] });
      let shot: Shot | null = null;
      await expect.poll(async () => {
        await core.send('submit_commands', { commands: [{ type: 'present' }] });
        shot = shotOf(await core.send('output_shared_texture_snapshot', { include_pixels: true, capture_source: 'slice:a' }));
        return PROBES.filter(p => seen(shot!, p)).length;
      }, { timeout: 8000 * rpcDeadlineScale, interval: 60 }).toBeGreaterThan(6);
      compare(shot!, path, label);
    } finally { core.close(); }
  }, 60000);
});
