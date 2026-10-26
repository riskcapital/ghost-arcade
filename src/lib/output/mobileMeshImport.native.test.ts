import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Layer } from '../types';
import { layerRenderMeshGrid } from '../utils/meshWarp';
import { phoneMeshLayer, type PhoneMesh } from './mobileMeshImport';

/**
 * A curved surface measured by the phone (LiDAR + stripes) on the native
 * compositor: the picture lands where the phone said, through a curved mesh
 * resting on the surface's part of the picture, and nothing shows past the
 * surface's edge.
 */

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
  if (!child.stdin || !child.stdout) throw new Error('native render-core stdio was not initialized');

  let nextId = 1;
  let stdout = '';
  const pending = new Map<number, {
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
        try {
          const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
          const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
          if (wait) {
            clearTimeout(wait.timer);
            pending.delete(message.id as number);
            if (message.ok) wait.resolve(message.result);
            else wait.reject(new Error(message.error || 'native rpc error'));
          }
        } catch {
          // non-JSON log line from the core
        }
      }
      index = stdout.indexOf('\n');
    }
  });

  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`native rpc timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, { timer, resolve, reject });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async close() {
      for (const [, wait] of pending) clearTimeout(wait.timer);
      pending.clear();
      child.kill();
    },
  };
}

const hasNativeCore = existsSync(nativeCoreBin);
const itIfNativeCore = hasNativeCore ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';



const SIZE = 256;
const SOURCE = 64;

let nativeLayerShapeState: typeof import('../sync/nativeRendererSync').nativeLayerShapeState;
let createLayer: typeof import('../types').createLayer;

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  ({ nativeLayerShapeState } = await import('../sync/nativeRendererSync'));
  ({ createLayer } = await import('../types'));
});

/** The source: red runs left to right, green top to bottom, so a pixel says which part of the picture it shows. */
function gradientFrame(): string {
  const bytes: number[] = [];
  for (let y = 0; y < SOURCE; y++) for (let x = 0; x < SOURCE; x++) bytes.push(Math.round(((x + 0.5) / SOURCE) * 255), Math.round(((y + 0.5) / SOURCE) * 255), 160, 255);
  return Buffer.from(bytes).toString('base64');
}

// Content (u, v, top-left origin) -> projector picture (top-left origin), as a curved surface bends it.
const F = (u: number, v: number) => ({ x: 0.1 + 0.55 * u + 0.25 * u * u, y: 0.12 + 0.55 * v + 0.2 * u * v });
const dFdu = (u: number, v: number) => ({ x: 0.55 + 0.5 * u, y: 0.2 * v });
const dFdv = (u: number) => ({ x: 0, y: 0.55 + 0.2 * u });
const rest = { u0: 0.2, v0: 0.15, u1: 0.8, v1: 0.85 };

function phoneMesh(rows: number, cols: number): PhoneMesh {
  const du = (rest.u1 - rest.u0) / (cols - 1), dv = (rest.v1 - rest.v0) / (rows - 1);
  const points = [], tangents = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = rest.u0 + c * du, v = rest.v0 + r * dv;
    points.push(F(u, v));
    const a = dFdu(u, v), b = dFdv(u);
    tangents.push({ right: { x: (a.x * du) / 3, y: (a.y * du) / 3 }, down: { x: (b.x * dv) / 3, y: (b.y * dv) / 3 } });
  }
  return { rows, cols, points, tangents, rest };
}

// The surface's edge in the picture: a lopsided pentagon inside the rest area.
const outline = [{ x: 0.3, y: 0.22 }, { x: 0.7, y: 0.25 }, { x: 0.75, y: 0.6 }, { x: 0.5, y: 0.8 }, { x: 0.25, y: 0.55 }];

type Snapshot = { width: number; height: number; bytes: Buffer; red: number; green: number; blue: number };
async function snapshot(rpc: NativeRpc): Promise<Snapshot> {
  const frame = await rpc.send('frame_snapshot', { include_pixels: true });
  const bgra = String(frame.format).toLowerCase().startsWith('bgra');
  return { width: Number(frame.width), height: Number(frame.height), bytes: Buffer.from(frame.rgba_b64, 'base64'), red: bgra ? 2 : 0, green: 1, blue: bgra ? 0 : 2 };
}
/** Channel at a projector position (0..1, top-left origin). */
function pixel(shot: Snapshot, p: { x: number; y: number }, channel: number): number {
  const px = Math.min(shot.width - 1, Math.max(0, Math.floor(p.x * shot.width)));
  const py = Math.min(shot.height - 1, Math.max(0, Math.floor(p.y * shot.height)));
  return shot.bytes[(py * shot.width + px) * 4 + channel];
}

describe('a curved surface from the phone on the native core', () => {
  itIfNativeCore('lands the picture where the phone measured it and masks it to the surface', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', { config: { backend: nativeBackend, width: SIZE, height: SIZE, source_frame_size: SOURCE, target_fps: 30 } }, 20000);
      expect(started?.backend_ready).toBe(true);
      await rpc.send('submit_commands', { commands: [{ type: 'upload_source_frame', source_id: 'phone-src', width: SOURCE, height: SOURCE, seq: 1, rgba_b64: gradientFrame() }] });
      const fields = phoneMeshLayer({ mesh: phoneMesh(6, 7), contentOutline: outline }, { x: 0, y: 0, w: 1, h: 1 })!;
      const layer: Layer = { ...createLayer('phone', 'Surface 1 (mapped)', 'media'), warpMode: 'mesh', ...fields, contentFit: 'fill' };
      const shape = nativeLayerShapeState(layer);
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: layer.id, opacity: 1, z_index: 0, corners: layer.corners, shape: shape.shape, shape2: shape.shape2, shape_meta: shape.shapeMeta, shape_points: shape.shapePoints, mesh_grid: layerRenderMeshGrid(layer) },
        { type: 'bind_media_source', layer_id: layer.id, source_id: 'phone-src', source_type: 'image', uri: 'memory://phone-src' },
        { type: 'present' },
      ] });
      const centre = F(0.5, 0.5);
      await expect.poll(async () => { const s = await snapshot(rpc); return pixel(s, centre, s.blue); }, { timeout: 5000, interval: 30, message: 'the layer must show' }).toBeGreaterThan(100);
      const shot = await snapshot(rpc);
      // Inside the surface: the colour says which part of the picture landed there.
      for (const [u, v] of [[0.5, 0.5], [0.4, 0.35], [0.62, 0.42], [0.5, 0.68], [0.36, 0.5]]) {
        const p = F(u, v);
        expect(Math.abs(pixel(shot, p, shot.red) - u * 255), `red at content ${u},${v}`).toBeLessThan(14);
        expect(Math.abs(pixel(shot, p, shot.green) - v * 255), `green at content ${u},${v}`).toBeLessThan(14);
      }
      // Past the surface's edge, still on the mesh: nothing.
      for (const [u, v] of [[0.24, 0.2], [0.76, 0.8], [0.23, 0.8], [0.78, 0.18]]) {
        const p = F(u, v);
        expect(pixel(shot, p, shot.blue), `masked at content ${u},${v}`).toBeLessThan(20);
      }
      // Off the mesh altogether: nothing.
      expect(pixel(shot, { x: 0.03, y: 0.03 }, shot.blue)).toBeLessThan(20);
      expect(pixel(shot, { x: 0.97, y: 0.97 }, shot.blue)).toBeLessThan(20);
    } finally { await rpc.close(); }
  }, 60000);
});
