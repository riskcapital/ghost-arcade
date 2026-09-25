import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MeshPointTangents, MeshWarpGrid } from '../types';
import { evaluateMeshGrid } from '../utils/meshWarp';

/**
 * Bezier mesh warp on the native compositor.
 *
 * A straight 16x16 mesh needs a dense grid before a curved cyclorama stops
 * looking faceted. With tangents, every cell is a Coons patch bounded by
 * cubic edges, inverted per pixel in heartbeat.wgsl (layer_mesh_uv_bezier).
 * These drive that path end to end: the top edge of a 4x4 mesh whose
 * tangents describe a parabola has to land on that parabola to the pixel
 * across all three cells (a kink at a cell boundary would miss the cubic
 * fit), keep doing so once the layer is corner-pinned, and a mesh without
 * tangents has to render exactly like the straight mesh it always was.
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
const IDENTITY_CORNERS = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

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

function channel(shot: Snapshot, x: number, y: number, offset: number): number {
  return shot.bytes[(y * shot.width + x) * 4 + offset];
}

/** First row (top-down) at column x where the red layer shows. */
function topEdgeRow(shot: Snapshot, x: number): number {
  for (let y = 0; y < shot.height; y++) {
    if (channel(shot, x, y, shot.red) > 127) return y;
  }
  return shot.height;
}

function solidFrame(rgba: number[]): string {
  return Buffer.from(Array.from({ length: SOURCE * SOURCE }, () => rgba).flat()).toString('base64');
}

function gradientFrame(): string {
  const bytes: number[] = [];
  for (let y = 0; y < SOURCE; y++) {
    for (let x = 0; x < SOURCE; x++) bytes.push(x * 4, y * 4, 128, 255);
  }
  return Buffer.from(bytes).toString('base64');
}

/** The top edge sags along y = 1 - 0.8 x (1 - x). A parabola is one cubic,
 *  so three Bezier cells whose points and tangents are read off it must
 *  reproduce it exactly: the edge must fit a single cubic across the whole
 *  width, cell boundaries included. */
const sag = (x: number) => 1 - 0.8 * x * (1 - x);
const sagSlope = (x: number) => -0.8 * (1 - 2 * x);

function parabolaMesh(): MeshWarpGrid {
  const rows = 4;
  const cols = 4;
  const h = 1 / (cols - 1);
  const points = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({
    x: col / (cols - 1),
    y: row === 0 ? sag(col / (cols - 1)) : 1 - row / (rows - 1),
  })));
  const tangents: (MeshPointTangents | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  for (let col = 0; col < cols; col++) {
    const x = col / (cols - 1);
    // Linked handles: the right tangent is stored and the left one mirrors it,
    // which is exactly the derivative continuity a parabola has.
    tangents[0][col] = col < cols - 1
      ? { right: { x: h / 3, y: (h / 3) * sagSlope(x) } }
      : { left: { x: -h / 3, y: -(h / 3) * sagSlope(x) } };
  }
  return { rows, cols, points, bezier: true, tangents };
}

/** Least-squares cubic through (x, y) samples; returns the max residual. */
function cubicFitResidual(samples: Array<[number, number]>): number {
  // Normal equations for degree 3.
  const n = 4;
  const ata = Array.from({ length: n }, () => new Array(n).fill(0));
  const atb = new Array(n).fill(0);
  for (const [x, y] of samples) {
    const basis = [1, x, x * x, x * x * x];
    for (let i = 0; i < n; i++) {
      atb[i] += basis[i] * y;
      for (let j = 0; j < n; j++) ata[i][j] += basis[i] * basis[j];
    }
  }
  // Gaussian elimination.
  const m = ata.map((row, i) => [...row, atb[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = m[r][i] / m[i][i];
      for (let c = i; c <= n; c++) m[r][c] -= factor * m[i][c];
    }
  }
  const coefficients = m.map((row, i) => row[n] / row[i]);
  let worst = 0;
  for (const [x, y] of samples) {
    const fit = coefficients[0] + coefficients[1] * x + coefficients[2] * x * x + coefficients[3] * x * x * x;
    worst = Math.max(worst, Math.abs(fit - y));
  }
  return worst;
}

async function startCore(rpc: NativeRpc): Promise<void> {
  const started = await rpc.send('start', {
    config: { backend: nativeBackend, width: SIZE, height: SIZE, source_frame_size: SOURCE, target_fps: 30 },
  }, 20000);
  expect(started?.backend_ready).toBe(true);
}

async function uploadLayer(rpc: NativeRpc, id: string, frame: string, corners: typeof IDENTITY_CORNERS, meshGrid: MeshWarpGrid | null): Promise<void> {
  await rpc.send('submit_commands', { commands: [
    { type: 'upload_source_frame', source_id: id, width: SOURCE, height: SOURCE, seq: 1, rgba_b64: frame },
    { type: 'upsert_layer', layer_id: id, opacity: 1, z_index: 0, corners, mesh_grid: meshGrid },
    { type: 'bind_media_source', layer_id: id, source_id: id, source_type: 'image', uri: `memory://${id}` },
    { type: 'present' },
  ] });
}

const SAMPLE_COLUMNS = Array.from({ length: 32 }, (_, i) => Math.round((i + 0.5) * SIZE / 32));

describe('Bezier mesh warp on the native core', () => {
  itIfNativeCore('bends a 4x4 mesh edge into one smooth cubic across its cells', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      const mesh = parabolaMesh();
      await uploadLayer(rpc, 'bezier-red', solidFrame([255, 0, 0, 255]), IDENTITY_CORNERS, mesh);

      await expect.poll(async () => {
        const shot = await snapshot(rpc);
        return channel(shot, SIZE / 2, SIZE - 8, shot.red) > 127 && channel(shot, SIZE / 2, 4, shot.red) < 32;
      }, { timeout: 5000, interval: 30, message: 'the red layer must show below the sagging edge and not above it' }).toBe(true);

      const shot = await snapshot(rpc);
      const samples: Array<[number, number]> = [];
      for (const px of SAMPLE_COLUMNS) {
        const x = (px + 0.5) / SIZE;
        const measured = topEdgeRow(shot, px);
        // Same surface the editor outline draws: the mesh evaluated at the
        // top edge, in output rows (y-down).
        const expected = (1 - evaluateMeshGrid(mesh, x, 1).y) * SIZE;
        expect(Math.abs(measured - expected), `edge at column ${px}: measured row ${measured}, expected ${expected.toFixed(2)}`).toBeLessThanOrEqual(1);
        expect(Math.abs((1 - sag(x)) * SIZE - expected)).toBeLessThan(0.01);
        samples.push([x, measured]);
      }
      // The whole edge is one cubic: no kink where the cells meet at x = 1/3 and 2/3.
      expect(cubicFitResidual(samples)).toBeLessThanOrEqual(1);
      // And it really is curved, not the straight chords of the old mesh.
      const chordRow = (1 - sag(1 / 3)) * SIZE * 0.5;
      expect(topEdgeRow(shot, Math.round(SIZE / 6))).toBeGreaterThan(chordRow + 4);
    } finally { await rpc.close(); }
  }, 60000);

  itIfNativeCore('keeps the curve on the picture when the layer is corner-pinned', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      const mesh = parabolaMesh();
      const corners = { topLeft: { x: 0.1, y: 0.9 }, topRight: { x: 0.9, y: 0.9 }, bottomRight: { x: 0.9, y: 0.1 }, bottomLeft: { x: 0.1, y: 0.1 } };
      await uploadLayer(rpc, 'bezier-pinned', solidFrame([255, 0, 0, 255]), corners, mesh);

      await expect.poll(async () => {
        const shot = await snapshot(rpc);
        return channel(shot, SIZE / 2, Math.round(SIZE * 0.5), shot.red) > 127 && channel(shot, SIZE / 2, 4, shot.red) < 32;
      }, { timeout: 5000, interval: 30 }).toBe(true);

      const shot = await snapshot(rpc);
      for (const px of SAMPLE_COLUMNS) {
        const x = (px + 0.5) / SIZE;
        if (x < 0.14 || x > 0.86) continue;
        const local = (x - 0.1) / 0.8;
        const mapped = evaluateMeshGrid(mesh, local, 1);
        const expected = (1 - (0.1 + 0.8 * mapped.y)) * SIZE;
        const measured = topEdgeRow(shot, px);
        expect(Math.abs(measured - expected), `pinned edge at column ${px}: measured row ${measured}, expected ${expected.toFixed(2)}`).toBeLessThanOrEqual(1);
      }
      // Outside the pinned quad nothing draws.
      expect(channel(shot, Math.round(SIZE * 0.05), SIZE / 2, shot.red)).toBeLessThan(32);
    } finally { await rpc.close(); }
  }, 60000);

  itIfNativeCore('renders a mesh without tangents on the straight path, matching explicit straight tangents', async () => {
    const rpc = createNativeRpc();
    try {
      await startCore(rpc);
      const rows = 4;
      const cols = 4;
      const points = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({
        x: col / (cols - 1), y: 1 - row / (rows - 1),
      })));
      points[1][1] = { x: 0.42, y: 0.58 };
      points[2][2] = { x: 0.6, y: 0.3 };
      const straight: MeshWarpGrid = { rows, cols, points };

      await uploadLayer(rpc, 'straight', gradientFrame(), IDENTITY_CORNERS, null);
      await expect.poll(async () => {
        const shot = await snapshot(rpc);
        return channel(shot, SIZE / 2, SIZE / 2, shot.blue);
      }, { timeout: 5000, interval: 30 }).toBeGreaterThan(100);
      const plain = await snapshot(rpc);

      const differingPixels = (a: Snapshot, b: Snapshot) => {
        let count = 0;
        for (let i = 0; i < a.bytes.length; i += 4) {
          if (a.bytes[i] !== b.bytes[i] || a.bytes[i + 1] !== b.bytes[i + 1] || a.bytes[i + 2] !== b.bytes[i + 2]) count++;
        }
        return count / (a.bytes.length / 4);
      };

      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'straight', opacity: 1, z_index: 0, corners: IDENTITY_CORNERS, mesh_grid: straight },
        { type: 'present' },
      ] });
      // frame_snapshot forces a render of the updated scene.
      await rpc.send('frame_snapshot', {});
      const before = await snapshot(rpc);
      // The moved points really warp the picture.
      expect(differingPixels(plain, before)).toBeGreaterThan(0.05);

      // Every tangent stored explicitly as a chord third: the Bezier path
      // with straight edges, which has to be the same surface.
      const tangents: (MeshPointTangents | null)[][] = points.map((row, r) => row.map((point, c) => {
        const third = (target?: { x: number; y: number }) => target ? { x: (target.x - point.x) / 3, y: (target.y - point.y) / 3 } : undefined;
        return {
          right: third(points[r][c + 1]),
          left: third(points[r][c - 1]),
          down: third(points[r + 1]?.[c]),
          up: third(points[r - 1]?.[c]),
        };
      }));
      await rpc.send('submit_commands', { commands: [
        { type: 'upsert_layer', layer_id: 'straight', opacity: 1, z_index: 0, corners: IDENTITY_CORNERS,
          mesh_grid: { rows, cols, points, bezier: true, tangents } },
        { type: 'present' },
      ] });
      await rpc.send('frame_snapshot', {});
      const after = await snapshot(rpc);

      expect(after.bytes.length).toBe(before.bytes.length);
      let worst = 0;
      for (let i = 0; i < before.bytes.length; i++) {
        worst = Math.max(worst, Math.abs(before.bytes[i] - after.bytes[i]));
      }
      // Newton lands within float precision of the bilinear inverse, so at
      // most the odd rounding step on an edge pixel may differ.
      expect(worst, 'straight-edged Bezier cells must match the bilinear mesh').toBeLessThanOrEqual(2);
      expect(differingPixels(before, after)).toBeLessThan(0.002);
    } finally { await rpc.close(); }
  }, 60000);
});
