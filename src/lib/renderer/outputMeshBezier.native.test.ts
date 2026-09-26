import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
import type { MeshPointTangents, MeshWarpGrid } from '../types';
import { evaluateMeshByRows } from '../utils/meshWarp';

let nativeWarpMeshGrid: typeof import('../sync/nativeRendererSync').nativeWarpMeshGrid;

beforeAll(async () => {
  // The sync module touches browser globals at import time.
  const storage = new Map<string, string>();
  const g = globalThis as any;
  g.localStorage ??= {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  g.document ??= { documentElement: { style: { setProperty: () => {} } } };
  g.window ??= {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  ({ nativeWarpMeshGrid } = await import('../sync/nativeRendererSync'));
});

/**
 * Bezier meshes on the output stage: the Master Warp and a screen's own
 * mesh, on the real GPU.
 *
 * Both are authored the way the editor stores them (rows down, y = 0 at the
 * top) and reach the core through the real sync conversion, so these also
 * cover the tangent flip. Snapshots are top row first, so editor y and
 * snapshot rows run the same way with no flips in the test.
 *
 * The Master Warp's points are destinations: its curved top edge is where
 * the picture now starts, and the core inverts each Coons cell per pixel.
 * A screen mesh is a forward map from the projector frame to the master:
 * with both of its rows bent along the same parabola, a straight line on
 * the master comes out as that parabola on the projector.
 */

type Command = Record<string, unknown>;

function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) {
      fail(new Error(`invalid native core response: ${String(error)}: ${line}`));
    }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 20000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) fail(error);
      });
    });
  };
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

const SIZE = 256;
const SOURCE = 32;

type Frame = { bytes: Buffer; stride: number; red: number };

function frameOf(snapshot: any): Frame {
  return {
    bytes: Buffer.from(snapshot.rgba_b64, 'base64'),
    stride: Number(snapshot.padded_bytes_per_row ?? snapshot.bytes_per_row ?? Number(snapshot.width) * 4),
    red: String(snapshot.format).toLowerCase().startsWith('bgra') ? 2 : 0,
  };
}

const redAt = (frame: Frame, x: number, y: number) => frame.bytes[y * frame.stride + x * 4 + frame.red];

/** First row, top down, where the picture is lit at column x. */
function firstLitRow(frame: Frame, x: number): number {
  for (let y = 0; y < SIZE; y++) if (redAt(frame, x, y) > 127) return y;
  return SIZE;
}

/** Least-squares cubic through (x, y) samples; returns the max residual. */
function cubicFitResidual(samples: Array<[number, number]>): number {
  const n = 4;
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const [x, y] of samples) {
    const basis = [1, x, x * x, x * x * x];
    for (let i = 0; i < n; i++) {
      m[i][n] += basis[i] * y;
      for (let j = 0; j < n; j++) m[i][j] += basis[i] * basis[j];
    }
  }
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
  const k = m.map((row, i) => row[n] / row[i]);
  let worst = 0;
  for (const [x, y] of samples) worst = Math.max(worst, Math.abs(k[0] + k[1] * x + k[2] * x * x + k[3] * x * x * x - y));
  return worst;
}

/** A parabola is one cubic, so a 4-column Bezier row whose points and
 *  linked tangents are read off it reproduces it exactly across all three
 *  cells. A kink where two cells meet would break the single-cubic fit. */
const sag = (x: number) => 0.05 + 0.6 * x * (1 - x);
const sagSlope = (x: number) => 0.6 * (1 - 2 * x);
const COLS = 4;

/** Editor-space (rows down) grid with the given rows on the parabola,
 *  shifted down by `offset[row]`, and straight edges everywhere else. */
function parabolaRows(rowY: Array<number | null>, bezier = true): MeshWarpGrid {
  const rows = rowY.length;
  const h = 1 / (COLS - 1);
  const points = rowY.map((offset, row) => Array.from({ length: COLS }, (_, col) => {
    const x = col / (COLS - 1);
    return { x, y: offset == null ? row / (rows - 1) : sag(x) + offset };
  }));
  const tangents: (MeshPointTangents | null)[][] = rowY.map((offset) => Array.from({ length: COLS }, (_, col) => {
    if (offset == null) return null;
    const x = col / (COLS - 1);
    return col < COLS - 1
      ? { right: { x: h / 3, y: (h / 3) * sagSlope(x) } }
      : { left: { x: -h / 3, y: -(h / 3) * sagSlope(x) } };
  }));
  return bezier ? { rows, cols: COLS, points, bezier: true, tangents } : { rows, cols: COLS, points };
}

/** The same points with every tangent stored as a chord third: Bezier cells
 *  whose edges are straight, which must match the plain bilinear mesh. */
function chordThirds(grid: MeshWarpGrid): MeshWarpGrid {
  const p = grid.points;
  const third = (a: { x: number; y: number }, b?: { x: number; y: number }) => (b ? { x: (b.x - a.x) / 3, y: (b.y - a.y) / 3 } : undefined);
  return {
    rows: grid.rows, cols: grid.cols, points: p, bezier: true,
    tangents: p.map((row, r) => row.map((point, c) => ({
      right: third(point, p[r][c + 1]), left: third(point, p[r][c - 1]),
      down: third(point, p[r + 1]?.[c]), up: third(point, p[r - 1]?.[c]),
    }))),
  };
}

const SAMPLE_COLUMNS = Array.from({ length: 32 }, (_, i) => Math.round((i + 0.5) * SIZE / 32));
const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

function slice(id: string, extra: Command = {}): Command {
  return { id, width: SIZE, height: SIZE, cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'rect', ...extra };
}

async function startWithRedLayer(rpc: ReturnType<typeof core>, corners: Command) {
  await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: SOURCE, target_fps: 30 } });
  await rpc.commands([
    { type: 'upload_source_frame', source_id: 'red', width: SOURCE, height: SOURCE, seq: 1,
      rgba_b64: Buffer.from(Array.from({ length: SOURCE * SOURCE }, () => [255, 0, 0, 255]).flat()).toString('base64') },
    { type: 'upsert_layer', layer_id: 'red', z_index: 0, opacity: 1, blend_mode: 'normal', corners },
    { type: 'bind_media_source', layer_id: 'red', source_id: 'red', uri: 'bezier-test://red', source_type: 'image' },
    { type: 'set_layer_visibility', layer_id: 'red', visible: true },
  ]);
  await expect.poll(async () => redAt(frameOf(await rpc.send('frame_snapshot', { include_pixels: true })), SIZE / 2, SIZE - 4),
    { timeout: 8000, interval: 30 }).toBeGreaterThan(200);
}

/** Pixels whose colour differs by more than rounding (2 levels). */
function differingPixels(a: Frame, b: Frame): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        const i = y * a.stride + x * 4 + c;
        worst = Math.max(worst, Math.abs(a.bytes[i] - b.bytes[i]));
      }
      if (worst > 2) out.push([x, y, worst]);
    }
  }
  return out;
}

const suite = platform.runnable ? describe : describe.skip;
suite('Bezier meshes on the output stage', () => {
  it('bends the Master Warp edge into one smooth cubic across its cells', async () => {
    const rpc = core();
    try {
      await startWithRedLayer(rpc, FULL);
      // Top row on the parabola, bottom row where it always was.
      const mesh = parabolaRows([0, null]);
      await rpc.commands([{ type: 'set_output_stage', masterWarp: {
        enabled: true, mode: 'mesh', corners: null, meshGrid: nativeWarpMeshGrid(mesh),
      } }]);
      await rpc.send('set_slice_outputs', { slices: [slice('bare')] });
      for (const target of ['main', 'bare']) {
        const shot = frameOf(await rpc.send('frame_snapshot', target === 'main'
          ? { include_pixels: true } : { include_pixels: true, slice_id: target }));
        const samples: Array<[number, number]> = [];
        for (const px of SAMPLE_COLUMNS) {
          const x = (px + 0.5) / SIZE;
          const measured = firstLitRow(shot, px);
          // The editor outline's curve: the mesh's top edge at this column.
          const expected = evaluateMeshByRows(mesh, x, 0).y * SIZE;
          expect(Math.abs(evaluateMeshByRows(mesh, x, 0).x - x)).toBeLessThan(1e-9);
          expect(Math.abs(measured - expected), `${target} column ${px}: row ${measured}, expected ${expected.toFixed(2)}`).toBeLessThanOrEqual(1);
          samples.push([x, measured]);
        }
        // One cubic across the cell boundaries at x = 1/3 and 2/3: no kink.
        expect(cubicFitResidual(samples), target).toBeLessThanOrEqual(1);
        // Really curved, not the straight chords of the old mesh: halfway
        // along the first cell the chord sits ~4 px above the curve.
        const chord = ((sag(0) + sag(1 / 3)) / 2) * SIZE;
        expect(firstLitRow(shot, Math.round(SIZE / 6 - 0.5)), target).toBeGreaterThan(chord + 3);
        // The warp still ends at the untouched bottom row.
        expect(redAt(shot, SIZE / 2, SIZE - 2)).toBeGreaterThan(200);
      }

      // Explicit straight tangents take the Bezier path but must draw the
      // same picture as the plain mesh.
      const kinked = parabolaRows([0, null], false);
      await rpc.commands([{ type: 'set_output_stage', masterWarp: { enabled: true, mode: 'mesh', meshGrid: nativeWarpMeshGrid(kinked) } }]);
      await rpc.send('set_slice_outputs', { slices: [slice('bare')] });
      const straight = frameOf(await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' }));
      await rpc.commands([{ type: 'set_output_stage', masterWarp: { enabled: true, mode: 'mesh', meshGrid: nativeWarpMeshGrid(chordThirds(kinked)) } }]);
      await rpc.send('set_slice_outputs', { slices: [slice('bare')] });
      const thirds = frameOf(await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' }));
      // Newton accepts a pixel a hair (0.0005 of a cell) outside the edge
      // that the bilinear solve rejects, so the odd edge pixel may flip,
      // exactly as on layer meshes. Nothing off the edge may change.
      const masterOff = differingPixels(straight, thirds);
      expect(masterOff.length / (SIZE * SIZE), 'straight Bezier cells must match the bilinear Master Warp').toBeLessThan(0.002);
      const lit = (x: number, y: number) => redAt(straight, Math.max(0, Math.min(SIZE - 1, x)), Math.max(0, Math.min(SIZE - 1, y))) > 127;
      for (const [x, y] of masterOff) {
        const onEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => lit(x + dx, y + dy) !== lit(x, y));
        expect(onEdge, `pixel ${x},${y} differs away from the mesh edge`).toBe(true);
      }

      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error ?? null).toBeNull();
      expect(status.last_frame_error ?? null).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 90000);

  it('bends a screen mesh so a straight master line leaves the projector as the cubic', async () => {
    const rpc = core();
    try {
      // Red fills the lower half of the master (editor y > 0.5).
      await startWithRedLayer(rpc, { topLeft: { x: 0, y: 0.5 }, topRight: { x: 1, y: 0.5 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } });
      // Both rows on the parabola, 0.6 apart, so each projector column
      // samples a straight vertical run of the master from sag(x) to
      // sag(x) + 0.6, and the master's y = 0.5 line lands on
      // v = (0.5 - sag(x)) / 0.6: a parabola on the projector.
      const mesh = parabolaRows([0, 0.6]);
      await rpc.send('set_slice_outputs', { slices: [slice('mesh', { warpMode: 'mesh', meshGrid: nativeWarpMeshGrid(mesh) })] });
      const shot = frameOf(await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'mesh' }));
      const samples: Array<[number, number]> = [];
      for (const px of SAMPLE_COLUMNS) {
        const u = (px + 0.5) / SIZE;
        const v = (0.5 - sag(u)) / 0.6;
        // The same point through the editor's surface: it lands on the line.
        expect(evaluateMeshByRows(mesh, u, v).y).toBeCloseTo(0.5, 9);
        const measured = firstLitRow(shot, px);
        const expected = v * SIZE;
        expect(Math.abs(measured - expected), `column ${px}: row ${measured}, expected ${expected.toFixed(2)}`).toBeLessThanOrEqual(1);
        samples.push([u, measured]);
      }
      expect(cubicFitResidual(samples)).toBeLessThanOrEqual(1);
      // Straight chords would put the line ~7 px lower mid-cell.
      const u6 = 1 / 6;
      const chordV = (0.5 - (sag(0) + sag(1 / 3)) / 2) / 0.6;
      expect(firstLitRow(shot, Math.round(SIZE * u6 - 0.5))).toBeLessThan(chordV * SIZE - 4);

      // Straight-edged Bezier cells equal the bilinear screen mesh.
      const plain = parabolaRows([0, 0.6], false);
      await rpc.send('set_slice_outputs', { slices: [slice('mesh', { warpMode: 'mesh', meshGrid: nativeWarpMeshGrid(plain) })] });
      const straight = frameOf(await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'mesh' }));
      await rpc.send('set_slice_outputs', { slices: [slice('mesh', { warpMode: 'mesh', meshGrid: nativeWarpMeshGrid(chordThirds(plain)) })] });
      const thirds = frameOf(await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'mesh' }));
      const screenOff = differingPixels(straight, thirds);
      expect(screenOff, 'straight Bezier cells must match the bilinear screen mesh').toEqual([]);

      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error ?? null).toBeNull();
      expect(status.last_frame_error ?? null).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 90000);
});
