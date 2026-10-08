import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

const suite = platform.runnable ? describe : describe.skip;
suite('Native live composite preview', () => {
  it('reads and downscales the program without re-rendering or changing output attachment', async () => {
    const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let sequence = 0;
    let stderr = '';
    const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-12000); });
    const fail = (error: Error) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
    };
    child.on('error', fail);
    child.on('exit', code => fail(new Error(`core exited ${code}: ${stderr}`)));
    createInterface({ input: child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      if (message.ok) p.resolve(message.result);
      else p.reject(new Error(message.error));
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: ${stderr}`)); }, 30000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    try {
      await send('start', { config: { backend: platform.rendererBackend, width: 128, height: 64, source_frame_size: 128, target_fps: 15 } });
      await send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: 'image', width: 16, height: 16, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 256 }, () => [180, 60, 20, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'image', opacity: 1,
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'image', source_id: 'image', uri: 'test://image', source_type: 'image' },
      ] });
      let preview: any;
      const deadline = Date.now() + 20000;
      do {
        preview = await send('frame_snapshot', { live_output: true, include_pixels: true, max_dim: 32 });
        if (Buffer.from(preview.rgba_b64, 'base64').some((v, i) => i % 4 !== 3 && v > 100)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      expect(preview).toMatchObject({ width: 32, height: 16, render_source: 'core-output-mirror' });
      const bytes = Buffer.from(preview.rgba_b64, 'base64');
      expect(bytes.some((v, i) => i % 4 !== 3 && v > 100)).toBe(true);
      expect(bytes.length).toBe(32 * 16 * 4);
      await send('stop');
      const before = await send('status');
      const frozen = await send('frame_snapshot', { live_output: true, include_pixels: true, max_dim: 128 });
      for (let i = 0; i < 3; i++) {
        const next = await send('frame_snapshot', { live_output: true, include_pixels: true, max_dim: 128 });
        expect(next.frame_index).toBe(frozen.frame_index);
        expect(next.rgba_b64).toBe(frozen.rgba_b64);
      }
      const after = await send('status');
      expect(after.gpu_frames_submitted).toBe(before.gpu_frames_submitted);
      expect(after.output_window_attached).toBe(before.output_window_attached);
      expect(frozen).toMatchObject({ width: 128, height: 64 });
    } finally {
      await closeNativeTestCore(child);
    }
  }, 90000);
});
