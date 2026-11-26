import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The Electron side is plain ESM JavaScript.
import { createCoreOutputReader, decodeCoreLine } from '../../../electron/core-ipc-frames.js';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

const suite = platform.runnable ? describe : describe.skip;
suite('Native snapshot pixels as raw bytes', () => {
  it('sends the same pixels raw as it does in base64', async () => {
    const child = spawn(platform.binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GA_CORE_IPC_FRAMES: '1', GA_CORE_IPC_BYTES: '1' },
    });
    let sequence = 0;
    let stderr = '';
    let hello = false;
    const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-12000); });
    const fail = (error: Error) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
    };
    child.on('error', fail);
    child.on('exit', code => fail(new Error(`core exited ${code}: ${stderr}`)));
    const reader = createCoreOutputReader((line: string, blobs: Buffer[] | null) => {
      if (!line) return;
      const message = decodeCoreLine(line, blobs);
      if (message.id === 0 && message.ipc_frames === 1) { hello = true; return; }
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      if (message.ok) p.resolve(message.result);
      else p.reject(new Error(message.error));
    });
    child.stdout.on('data', chunk => reader.push(chunk));
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: ${stderr}`)); }, 30000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    try {
      await send('start', { config: { backend: platform.rendererBackend, width: 128, height: 64, source_frame_size: 128, target_fps: 15 } });
      expect(hello).toBe(true);
      // A gradient, so a swapped channel or a shifted row would show.
      const image = Buffer.from(Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) & 255, 255]).flat());
      await send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: 'image', width: 16, height: 16, seq: 1, rgba_b64: image.toString('base64') },
        { type: 'upsert_layer', layer_id: 'image', opacity: 1,
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'image', source_id: 'image', uri: 'test://image', source_type: 'image' },
      ] });
      const deadline = Date.now() + 20000;
      for (;;) {
        const probe = await send('frame_snapshot', { live_output: true, include_pixels: true, max_dim: 32 });
        if (Buffer.from(probe.rgba_b64, 'base64').some((v, i) => i % 4 !== 3 && v > 100)) break;
        if (Date.now() > deadline) throw new Error('no picture');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // A stopped core keeps its last frame, so both reads see one picture.
      await send('stop');
      const pairs: Array<[string, Record<string, unknown>, 'rgba' | 'jpeg']> = [
        ['composite', { live_output: true, include_pixels: true, max_dim: 128 }, 'rgba'],
        ['composite jpeg', { live_output: true, include_pixels: true, max_dim: 128, encoding: 'jpeg', quality: 82 }, 'jpeg'],
        ['frame', { include_pixels: true }, 'rgba'],
        ['source', { layer_id: 'image', include_pixels: true, max_dim: 64 }, 'rgba'],
        ['source jpeg', { layer_id: 'image', include_pixels: true, width: 64, height: 64, encoding: 'jpeg' }, 'jpeg'],
      ];
      for (const [label, params, kind] of pairs) {
        const text = await send('frame_snapshot', params);
        const raw = await send('frame_snapshot', { ...params, pixel_bytes: true });
        expect(text[`${kind}_raw`], label).toBeUndefined();
        expect(raw[`${kind}_b64`], label).toBeUndefined();
        expect(raw[`${kind}_raw`], label).toBeInstanceOf(Uint8Array);
        const fromText = Buffer.from(text[`${kind}_b64`], 'base64');
        expect(fromText.length, label).toBeGreaterThan(0);
        expect(Buffer.from(raw[`${kind}_raw`]).equals(fromText), label).toBe(true);
        expect(raw.width, label).toBe(text.width);
        expect(raw.checksum, label).toBe(text.checksum);
      }
    } finally {
      await closeNativeTestCore(child);
    }
  }, 90000);
});
