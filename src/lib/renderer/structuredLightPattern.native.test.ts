import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';
import { projectorCalibrationUniforms } from '../output/projectorCalibration';
import { stripeFrameCode, type StripeFrame } from '../mobile/studio/structuredLightCodes';

/**
 * The stripes a Screen shows for auto-mapping, read back from the GPU and
 * compared pixel for pixel with the Gray code the phone's decoder assumes.
 * If these disagree the phone decodes garbage, so every frame is checked on
 * landscape and portrait rasters whose sizes are not multiples of the cell.
 */
type Command = Record<string, unknown>;
function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error)));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return { send, async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); } };
}

/** The reference: bit 0 is the most significant bit of gray(floor(p / cell)). */
function expected(frame: StripeFrame, x: number, y: number, width: number, height: number, STRIPE_CELL: number): number {
  if (frame.kind === 'white') return 1;
  if (frame.kind === 'black') return 0;
  const size = frame.axis === 'x' ? width : height;
  const bits = Math.ceil(Math.log2(Math.ceil(size / STRIPE_CELL)));
  const cell = Math.floor((frame.axis === 'x' ? x : y) / STRIPE_CELL);
  const gray = cell ^ (cell >> 1);
  return ((gray >> (bits - 1 - frame.bit)) & 1) ^ (frame.inverted ? 1 : 0);
}

function frames(width: number, height: number, STRIPE_CELL: number): StripeFrame[] {
  const list: StripeFrame[] = [{ kind: 'white' }, { kind: 'black' }];
  for (const axis of ['x', 'y'] as const) {
    const bits = Math.ceil(Math.log2(Math.ceil((axis === 'x' ? width : height) / STRIPE_CELL)));
    for (let bit = 0; bit < bits; bit++) for (const inverted of [false, true]) list.push({ kind: 'bit', axis, bit, inverted });
  }
  return list;
}

const suite = platform.runnable ? describe : describe.skip;
suite('Auto-map stripe patterns on a Screen', () => {
  it.each([[324, 196, 8], [196, 324, 8], [324, 196, 32], [500, 280, 16]])('draws every frame exactly at %i x %i, cell %i', async (width, height, cell) => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 256, height: 256, source_frame_size: 128, target_fps: 30 } });
      let wrong = 0, checked = 0;
      for (const frame of frames(width, height, cell)) {
        const calibration = projectorCalibrationUniforms({});
        calibration[4][3] = stripeFrameCode(frame, cell);
        await rpc.send('set_slice_outputs', { slices: [{ id: 'a', width, height, cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'rect', alignmentAid: 3, projectorCalibration: calibration }] });
        await rpc.send('submit_commands', { commands: [{ type: 'present' }] });
        await new Promise(r => setTimeout(r, 90));
        const shot = await rpc.send('output_shared_texture_snapshot', { include_pixels: true, capture_source: 'slice:a' });
        expect([shot.width, shot.height]).toEqual([width, height]);
        const bytes = Buffer.from(shot.rgba_b64, 'base64');
        const packed = width * 4;
        const stride = bytes.length === packed * height ? packed : Number(shot.padded_bytes_per_row ?? packed);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const lit = bytes[y * stride + x * 4 + 1] > 127 ? 1 : 0;
          checked++;
          if (lit !== expected(frame, x, y, width, height, cell)) wrong++;
        }
      }
      expect(checked).toBeGreaterThan(width * height * 8);
      expect(wrong).toBe(0);
    } finally { await rpc.close(); }
  }, 60000);
});
