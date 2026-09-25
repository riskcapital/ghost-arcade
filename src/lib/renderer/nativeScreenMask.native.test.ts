import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
import { screenMaskAlpha } from '../stores/screenMaskGeometry';
import type { ScreenMask } from '../stores/settings';

let nativeScreenMasks: typeof import('../sync/nativeRendererSync').nativeScreenMasks;

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
  ({ nativeScreenMasks } = await import('../sync/nativeRendererSync'));
});

/**
 * Per-screen masks on the real GPU.
 *
 * A screen output is a second composite of the master with that screen's
 * crop, warp, grade and blend. Masks are cut from the screen's own frame
 * after the crop and warp have been resolved, so the pixels read back here
 * come from the same presenter pass a slice display shows. The core takes
 * mask points in its y-up screen UV; the editor's y flip is covered by the
 * sync unit tests.
 */

const binary = platform.binary;
type Command = Record<string, unknown>;

function core() {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
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

const SIZE = 128;

/** Snapshot pixels are BGRA, top row first. Returns [r, g, b] at a pixel. */
function pixel(frame: any, x: number, y: number): [number, number, number] {
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const stride = Number(frame.padded_bytes_per_row ?? frame.bytes_per_row ?? Number(frame.width) * 4);
  const offset = y * stride + x * 4;
  const p = [...bytes.subarray(offset, offset + 4)];
  if (String(frame.format).toLowerCase().startsWith('bgra')) [p[0], p[2]] = [p[2], p[0]];
  return [p[0], p[1], p[2]];
}

/** Pixel column for a screen-space u, row for a y-up v. */
const col = (u: number) => Math.round(u * SIZE - 0.5);
const row = (v: number) => Math.round((1 - v) * SIZE - 0.5);

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

function slice(id: string, extra: Command = {}): Command {
  return {
    id, width: SIZE, height: SIZE,
    cropX: 0, cropY: 0, cropW: 1, cropH: 1,
    warpMode: 'rect',
    ...extra,
  };
}

const suite = platform.runnable ? describe : describe.skip;
suite('Native screen masks', () => {
  it('keeps inside, cuts inverted holes, feathers monotonically and follows a corner-pinned screen', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 32, target_fps: 30 } });
      // One solid white layer over the whole master, so every non-black
      // output pixel is the mask alone.
      await rpc.commands([
        { type: 'upload_source_frame', source_id: 'white', width: 32, height: 32, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 32 * 32 }, () => [255, 255, 255, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'white', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'white', source_id: 'white', uri: 'mask-test://white', source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: 'white', visible: true },
      ]);
      await expect.poll(async () => {
        const frame = await rpc.send('frame_snapshot', { include_pixels: true });
        return pixel(frame, 64, 64);
      }, { timeout: 8000, interval: 30 }).toEqual([255, 255, 255]);

      const masks = [
        // Keep the middle of the frame with a wide feather...
        { id: 'keep', enabled: true, invert: false, feather: 0.3, points: rect(0.05, 0.05, 0.95, 0.95) },
        // ...and punch a hard hole near the top-right corner.
        { id: 'hole', enabled: true, invert: true, feather: 0, points: rect(0.7, 0.7, 0.9, 0.9) },
        // Neither of these may change anything.
        { id: 'off', enabled: false, invert: true, feather: 0, points: rect(0.4, 0.4, 0.6, 0.6) },
        { id: 'line', enabled: true, invert: true, feather: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ];
      const pinned = {
        topLeft: { x: 0.1, y: 0.95 }, topRight: { x: 0.8, y: 0.9 },
        bottomRight: { x: 0.95, y: 0.15 }, bottomLeft: { x: 0.2, y: 0.05 },
      };
      const applied = await rpc.send('set_slice_outputs', { slices: [
        slice('plain', { masks }),
        slice('pinned', { warpMode: 'corners', corners: pinned, masks }),
        slice('bare'),
      ] });
      expect(applied.slices).toEqual(['plain', 'pinned', 'bare']);

      const plain = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(Number(plain.width)).toBe(SIZE);
      // Inside the kept region, past the feather: untouched white.
      expect(pixel(plain, col(0.5), row(0.5))).toEqual([255, 255, 255]);
      // Outside the keep polygon: black on every side.
      expect(pixel(plain, col(0.02), row(0.5))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.98), row(0.5))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.5), row(0.02))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.5), row(0.98))).toEqual([0, 0, 0]);
      // Inside the inverted hole: black, even though the keep mask covers it.
      expect(pixel(plain, col(0.8), row(0.8))).toEqual([0, 0, 0]);
      // Just outside the hole, still inside the keep ramp: lit.
      expect(pixel(plain, col(0.65), row(0.65))[0]).toBeGreaterThan(40);
      // The feather ramps monotonically from the keep edge (u=0.05) to full
      // strength 0.3 further in, and is genuinely partial in the middle.
      const ramp = Array.from({ length: col(0.36) - col(0.05) + 1 }, (_, i) => pixel(plain, col(0.05) + i, row(0.5))[0]);
      for (let i = 1; i < ramp.length; i++) expect(ramp[i], `ramp step ${i}: ${ramp.join(',')}`).toBeGreaterThanOrEqual(ramp[i - 1]);
      expect(ramp[0]).toBeLessThan(20);
      expect(ramp[ramp.length - 1]).toBe(255);
      const middle = pixel(plain, col(0.2), row(0.5))[0];
      expect(middle).toBeGreaterThan(20);
      expect(middle).toBeLessThan(235);

      // Corner-pinning the screen re-maps what the projector samples, but
      // the masks are cut from the projector's frame, so every masked
      // pixel stays exactly where it was.
      const warped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'pinned' });
      expect(Buffer.from(warped.rgba_b64, 'base64').equals(Buffer.from(plain.rgba_b64, 'base64'))).toBe(true);

      // Same under the Master Warp, which is how the Screens panel corner-
      // pins today: the screen samples the master-warped frame, the mask is
      // still cut from the screen's own frame. The pull-in (0.03) stays
      // inside the region the keep mask already blacks out.
      await rpc.send('submit_commands', { commands: [{ type: 'set_output_stage', masterWarp: {
        enabled: true, mode: 'corners', corners: {
          topLeft: { x: 0.03, y: 0.02 }, topRight: { x: 0.98, y: 0.03 },
          bottomRight: { x: 0.97, y: 0.98 }, bottomLeft: { x: 0.02, y: 0.97 },
        },
      } }] });
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks }), slice('bare')] });
      const masterWarped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(Buffer.from(masterWarped.rgba_b64, 'base64').equals(Buffer.from(plain.rgba_b64, 'base64'))).toBe(true);
      // The warp really is on: an unmasked screen loses its outer corner.
      const bareWarped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' });
      expect(pixel(bareWarped, 0, 0)).toEqual([0, 0, 0]);
      expect(pixel(bareWarped, 64, 64)).toEqual([255, 255, 255]);
      await rpc.send('submit_commands', { commands: [{ type: 'set_output_stage', masterWarp: { enabled: false } }] });
      // Slices copy the master warp when applied, so re-send them unwarped.
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks }), slice('bare')] });

      // A screen without masks, and a screen whose only masks are unusable,
      // show the full frame.
      const bare = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' });
      expect(pixel(bare, col(0.02), row(0.5))).toEqual([255, 255, 255]);
      expect(pixel(bare, col(0.8), row(0.8))).toEqual([255, 255, 255]);
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks: masks.slice(2) })] });
      const unusable = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(pixel(unusable, col(0.5), row(0.5))).toEqual([255, 255, 255]);
      expect(pixel(unusable, col(0.02), row(0.5))).toEqual([255, 255, 255]);

      await expect(rpc.send('frame_snapshot', { include_pixels: false, slice_id: 'missing' })).rejects.toThrow(/unknown screen output/);
      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error ?? null).toBeNull();
      expect(status.last_frame_error ?? null).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 90000);

  it('matches the editor preview mask shading pixel for pixel, including through a corner pin', async () => {
    // Authored the way the Screens inspector stores them: screen content
    // space, y=0 at the top. They reach the core through the real sync
    // conversion, and the snapshot is top row first, so snapshot pixel
    // (col, row) and editor point ((col + .5) / SIZE, (row + .5) / SIZE)
    // are the same spot on the projector with no flips in this test.
    const editorMasks: ScreenMask[] = [
      { id: 'a', name: 'Arch', enabled: true, invert: false, feather: 0.3,
        points: [{ x: 0.08, y: 0.9 }, { x: 0.12, y: 0.2 }, { x: 0.5, y: 0.04 }, { x: 0.93, y: 0.22 }, { x: 0.9, y: 0.92 }] },
      { id: 'b', name: 'Door', enabled: true, invert: true, feather: 0,
        points: [{ x: 0.42, y: 0.55 }, { x: 0.61, y: 0.55 }, { x: 0.61, y: 0.97 }, { x: 0.42, y: 0.97 }] },
    ];
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 32, target_fps: 30 } });
      await rpc.commands([
        { type: 'upload_source_frame', source_id: 'white', width: 32, height: 32, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 32 * 32 }, () => [255, 255, 255, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'white', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'white', source_id: 'white', uri: 'mask-test://white', source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: 'white', visible: true },
      ]);
      await expect.poll(async () => pixel(await rpc.send('frame_snapshot', { include_pixels: true }), 64, 64),
        { timeout: 8000, interval: 30 }).toEqual([255, 255, 255]);
      await rpc.send('set_slice_outputs', { slices: [
        slice('flat', { masks: nativeScreenMasks(editorMasks) }),
        slice('pinned', { warpMode: 'corners', masks: nativeScreenMasks(editorMasks), corners: {
          topLeft: { x: 0.2, y: 0.05 }, topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.8, y: 0.95 }, bottomLeft: { x: 0.05, y: 0.85 },
        } }),
      ] });
      for (const id of ['flat', 'pinned']) {
        const frame = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: id });
        let worst = 0;
        let off = 0;
        for (let row = 0; row < SIZE; row++) {
          for (let c = 0; c < SIZE; c++) {
            const expected = 255 * screenMaskAlpha(editorMasks, { x: (c + 0.5) / SIZE, y: (row + 0.5) / SIZE });
            const diff = Math.abs(pixel(frame, c, row)[0] - expected);
            worst = Math.max(worst, diff);
            if (diff > 2) off++;
          }
        }
        // The core evaluates in f32, the preview in f64; allow rounding only.
        expect(off, `${id}: ${off} pixels differ by more than 2 levels, worst ${worst}`).toBe(0);
      }
      // The doorway is on the bottom edge of the projected image, as drawn.
      const flat = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'flat' });
      expect(pixel(flat, col(0.5), SIZE - 4)).toEqual([0, 0, 0]);
      expect(pixel(flat, col(0.5), 51)).toEqual([255, 255, 255]);
    } finally {
      await rpc.close();
    }
  }, 90000);
});
