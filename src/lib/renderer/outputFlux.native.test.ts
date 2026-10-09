import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * Flux on the output stage, driven the way a paired phone drives it: off
 * leaves a Screen untouched, each module changes the picture, wet amount 0
 * is the clean picture again, and Multiply never brightens.
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
  return { send, commands: (commands: Command[]) => send('submit_commands', { commands }), async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); } };
}

const SIZE = 256;
const quad = (x0: number, x1: number) => ({ topLeft: { x: x0, y: 0 }, topRight: { x: x1, y: 0 }, bottomRight: { x: x1, y: 1 }, bottomLeft: { x: x0, y: 1 } });
const MODULES = ['warp', 'fold', 'prism', 'echo', 'solar', 'slice', 'tile', 'tunnel', 'pixel', 'glitch', 'ink', 'throb'];

const suite = platform.runnable ? describe : describe.skip;
suite('Flux on the output', () => {
  it('changes a Screen only while it plays, for every module', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 128, target_fps: 30 } });
      // A picture with structure: a red band, a green band and a blue band.
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'r', z_index: 1, opacity: 1, blend_mode: 'normal', corners: quad(0, 0.3) }, { type: 'set_layer_color', layer_id: 'r', rgba: [1, 0.1, 0.1, 1] },
        { type: 'upsert_layer', layer_id: 'g', z_index: 2, opacity: 1, blend_mode: 'normal', corners: quad(0.3, 0.72) }, { type: 'set_layer_color', layer_id: 'g', rgba: [0.1, 0.9, 0.2, 1] },
        { type: 'upsert_layer', layer_id: 'b', z_index: 3, opacity: 1, blend_mode: 'normal', corners: quad(0.72, 1) }, { type: 'set_layer_color', layer_id: 'b', rgba: [0.1, 0.2, 1, 1] },
        { type: 'present' },
      ]);
      await rpc.send('set_slice_outputs', { slices: [{ id: 'a', width: SIZE, height: SIZE, cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'rect' }] });
      const shot = async (flux: Command | null) => {
        await rpc.commands([{ type: 'set_output_flux', ...(flux ?? { gain: 0 }) }, { type: 'present' }]);
        let last = '', bytes = Buffer.alloc(0);
        // The Screen redraws on its own clock: read until two reads agree.
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(r => setTimeout(r, 80));
          const frame = await rpc.send('output_shared_texture_snapshot', { include_pixels: true, capture_source: 'slice:a' });
          if (frame.rgba_b64 === last && attempt > 1) { bytes = Buffer.from(frame.rgba_b64, 'base64'); break; }
          last = frame.rgba_b64; bytes = Buffer.from(frame.rgba_b64, 'base64');
        }
        return bytes;
      };
      const differ = (a: Buffer, b: Buffer) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n / (a.length / 4); };
      const sum = (a: Buffer) => { let n = 0; for (let i = 0; i < a.length; i += 4) n += a[i] + a[i + 1] + a[i + 2]; return n; };

      const clean = await shot(null);
      expect(sum(clean)).toBeGreaterThan(0);
      const status = await rpc.send('status');
      expect(status.last_shader_error ?? null).toBeNull();

      for (const [bit, name] of MODULES.entries()) {
        // Beat lock off, so the time-based modules have something to move with.
        const played = await shot({ x: 0.72, y: 0.6, energy: 0.2, gain: 1, blend: 0, beat_lock: 0, modules: 1 << bit });
        expect(differ(clean, played), `${name} changes the picture`).toBeGreaterThan(0.02);
      }
      // Wet amount 0 is the clean picture, whatever is selected.
      expect(differ(clean, await shot({ x: 0.72, y: 0.6, gain: 0, modules: 4095 }))).toBe(0);
      // Multiply can only darken.
      const multiplied = await shot({ x: 0.72, y: 0.6, gain: 1, blend: 3, modules: 1 });
      expect(sum(multiplied)).toBeLessThan(sum(clean));
      // And off again restores it.
      expect(differ(clean, await shot(null))).toBe(0);
      expect((await rpc.send('status')).last_frame_error ?? null).toBeNull();
    } finally { await rpc.close(); }
  }, 120000);
});
