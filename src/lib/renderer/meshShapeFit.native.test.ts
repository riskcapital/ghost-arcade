import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BezierPoint, Layer, MeshWarpGrid } from '../types';
import { evaluateMeshGrid, withMeshPoints } from '../utils/meshWarp';
import { fittedMeshGrid } from '../utils/meshShapeFit';

/**
 * Mesh warp fitted to a Custom Shape on the native compositor.
 *
 * A fitted mesh rests on the shape (MeshWarpGrid.rest): heartbeat.wgsl reads
 * each cell's layer position from the rest lattice. Unwarped, the layer must
 * render exactly as it does with no mesh at all; moving a point of the
 * fitted mesh must move the shape next to it, which a mesh over the whole
 * layer could not do from its far-away points.
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
const CORNERS = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

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

type Snapshot = { width: number; height: number; bytes: Buffer; red: number; green: number; blue: number };

async function snapshot(rpc: NativeRpc): Promise<Snapshot> {
  const frame = await rpc.send('frame_snapshot', { include_pixels: true });
  const bgra = String(frame.format).toLowerCase().startsWith('bgra');
  return {
    width: Number(frame.width),
    height: Number(frame.height),
    bytes: Buffer.from(frame.rgba_b64, 'base64'),
    red: bgra ? 2 : 0,
    green: 1,
    blue: bgra ? 0 : 2,
  };
}

/** Channel at a layer position (0..1, y up) on the identity-cornered canvas. */
function at(shot: Snapshot, x: number, y: number, offset: number): number {
  const px = Math.min(shot.width - 1, Math.max(0, Math.floor(x * shot.width)));
  const py = Math.min(shot.height - 1, Math.max(0, Math.floor((1 - y) * shot.height)));
  return shot.bytes[(py * shot.width + px) * 4 + offset];
}

function gradientFrame(): string {
  const bytes: number[] = [];
  for (let y = 0; y < SOURCE; y++) {
    for (let x = 0; x < SOURCE; x++) bytes.push(x * 4, y * 4, 160, 255);
  }
  return Buffer.from(bytes).toString('base64');
}

function shapedLayer(points: BezierPoint[]): Layer {
  const layer = createLayer('fit', 'Fitted', 'media');
  layer.corners = CORNERS;
  layer.layerShape = {
    type: 'custom',
    enabled: true,
    params: { feather: 0, rotation: 0, customPoints: points, customClosed: true },
  } as Layer['layerShape'];
  return layer;
}

const square: BezierPoint[] = [{ x: 0.25, y: 0.7 }, { x: 0.6, y: 0.7 }, { x: 0.6, y: 0.3 }, { x: 0.25, y: 0.3 }];

function circle(cx: number, cy: number, r: number): BezierPoint[] {
  const k = 0.5523 * r;
  return [
    { x: cx, y: cy + r, cpIn: { x: cx - k, y: cy + r }, cpOut: { x: cx + k, y: cy + r } },
    { x: cx + r, y: cy, cpIn: { x: cx + r, y: cy + k }, cpOut: { x: cx + r, y: cy - k } },
    { x: cx, y: cy - r, cpIn: { x: cx + k, y: cy - r }, cpOut: { x: cx - k, y: cy - r } },
    { x: cx - r, y: cy, cpIn: { x: cx - r, y: cy - k }, cpOut: { x: cx - r, y: cy + k } },
  ];
}

async function startCore(rpc: NativeRpc): Promise<void> {
  const started = await rpc.send('start', {
    config: { backend: nativeBackend, width: SIZE, height: SIZE, source_frame_size: SOURCE, target_fps: 30 },
  }, 20000);
  expect(started?.backend_ready).toBe(true);
  await rpc.send('submit_commands', { commands: [
    { type: 'upload_source_frame', source_id: 'fit-src', width: SOURCE, height: SOURCE, seq: 1, rgba_b64: gradientFrame() },
  ] });
}

async function render(rpc: NativeRpc, layer: Layer, mesh: MeshWarpGrid | null): Promise<Snapshot> {
  const shape = nativeLayerShapeState(layer);
  await rpc.send('submit_commands', { commands: [
    {
      type: 'upsert_layer', layer_id: layer.id, opacity: 1, z_index: 0, corners: layer.corners,
      shape: shape.shape, shape2: shape.shape2, shape_meta: shape.shapeMeta, shape_points: shape.shapePoints,
      mesh_grid: mesh,
    },
    { type: 'bind_media_source', layer_id: layer.id, source_id: 'fit-src', source_type: 'image', uri: 'memory://fit-src' },
    { type: 'present' },
  ] });
  await expect.poll(async () => {
    const shot = await snapshot(rpc);
    return at(shot, 0.42, 0.5, shot.blue);
  }, { timeout: 5000, interval: 30, message: 'the shaped layer must show' }).toBeGreaterThan(100);
  return snapshot(rpc);
}

function differingShare(a: Snapshot, b: Snapshot, tolerance = 3): number {
  let count = 0;
  for (let i = 0; i < a.bytes.length; i += 4) {
    if (Math.abs(a.bytes[i] - b.bytes[i]) > tolerance || Math.abs(a.bytes[i + 1] - b.bytes[i + 1]) > tolerance
      || Math.abs(a.bytes[i + 2] - b.bytes[i + 2]) > tolerance) count++;
  }
  return count / (a.bytes.length / 4);
}

describe('mesh fitted to a Custom Shape on the native core', () => {
  itIfNativeCore('renders an unwarped fitted mesh exactly like no mesh', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      for (const [name, points, fit] of [
        ['square on its bounds', square, 'shape'],
        ['circle along its outline', circle(0.45, 0.5, 0.22), 'outline'],
      ] as const) {
        const layer = shapedLayer(points as BezierPoint[]);
        const plain = await render(rpc, layer, null);
        const { grid, fitted } = fittedMeshGrid(layer.layerShape, 4, 4, fit);
        expect(fitted, name).toBe(fit);
        const meshed = await render(rpc, layer, grid);
        // Only the anti-aliased rim may round differently.
        expect(differingShare(plain, meshed), name).toBeLessThan(0.002);
      }
    } finally { await rpc.close(); }
  }, 60000);

  itIfNativeCore('moves the shape with the fitted mesh point next to it', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      const layer = shapedLayer(square);
      const { grid } = fittedMeshGrid(layer.layerShape, 3, 3, 'shape');
      const points = grid.points.map((row) => row.map((p) => ({ ...p })));
      // Pull the top-right point up and to the right.
      points[0][2] = { x: points[0][2].x + 0.12, y: points[0][2].y + 0.1 };
      const warped = withMeshPoints(grid, points);
      const shot = await render(rpc, layer, warped);

      // The shape's top-right corner lands where the mesh sends it.
      const corner = evaluateMeshGrid(warped, 0.6, 0.7);
      expect(corner.x).toBeGreaterThan(0.69);
      expect(corner.y).toBeGreaterThan(0.77);
      const inside = evaluateMeshGrid(warped, 0.57, 0.67);
      expect(at(shot, inside.x, inside.y, shot.blue), 'just inside the moved corner').toBeGreaterThan(100);
      // That spot was outside the unwarped square.
      expect(inside.x > 0.6 || inside.y > 0.7).toBe(true);
      // The opposite corner stays put, and the content there is unchanged.
      expect(at(shot, 0.27, 0.32, shot.blue)).toBeGreaterThan(100);
      expect(at(shot, 0.23, 0.28, shot.blue)).toBeLessThan(40);
      // Content moves with the shape: the colour at the moved corner is the
      // colour the square had at its corner (the gradient's red and green).
      const plain = await render(rpc, layer, null);
      const sourceCorner = { r: at(plain, 0.57, 0.67, plain.red), g: at(plain, 0.57, 0.67, plain.green) };
      expect(Math.abs(at(shot, inside.x, inside.y, shot.red) - sourceCorner.r)).toBeLessThanOrEqual(12);
      expect(Math.abs(at(shot, inside.x, inside.y, shot.green) - sourceCorner.g)).toBeLessThanOrEqual(12);
    } finally { await rpc.close(); }
  }, 60000);

  itIfNativeCore('bulges a circle where an outline mesh border point is pulled out', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      const layer = shapedLayer(circle(0.45, 0.5, 0.2));
      const { grid, fitted } = fittedMeshGrid(layer.layerShape, 4, 4, 'outline');
      expect(fitted).toBe('outline');
      // The border point nearest the circle's right side.
      let best = { r: 0, c: 0, d: Infinity };
      grid.rest!.forEach((row, r) => row.forEach((p, c) => {
        const d = Math.hypot(p.x - 0.65, p.y - 0.5);
        if (d < best.d) best = { r, c, d };
      }));
      expect(best.d).toBeLessThan(0.08);
      const points = grid.points.map((row) => row.map((p) => ({ ...p })));
      points[best.r][best.c] = { x: points[best.r][best.c].x + 0.12, y: points[best.r][best.c].y };
      const shot = await render(rpc, layer, withMeshPoints(grid, points));
      const pulled = grid.rest![best.r][best.c];
      // Past the circle's old edge, toward the pulled point: now covered.
      expect(at(shot, pulled.x + 0.05, pulled.y, shot.blue)).toBeGreaterThan(100);
      // The far side of the circle has not moved.
      expect(at(shot, 0.27, 0.5, shot.blue)).toBeGreaterThan(100);
      expect(at(shot, 0.23, 0.5, shot.blue)).toBeLessThan(40);
    } finally { await rpc.close(); }
  }, 60000);
});
