import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';

// The Windows bridge is required on a built Windows host: a missing/broken
// addon must fail instead of silently skipping the actual GPU capture check.
it.skipIf(!platform.windows || !platform.runnable)('reads native DXGI output as packed BGRA across updates, resize and release', async () => {
  const addon = createRequire(import.meta.url)(resolve('electron/native/build/Release/dxgi_preview_addon.node'));
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let serial = 0, stderr = '';
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-8000); });
  const fail = (error: Error) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error(`Core exited: ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result); else request.reject(new Error(message.error));
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let seq = 0;
  async function render(width: number, height: number) {
    await send('start', { config: { backend: 'd3d12', width, height, source_frame_size: 64, target_fps: 30 } });
    const rgba = Buffer.from(Array.from({ length: 64 * 64 }, (_, i) => [i % 64 < 32 ? 220 : 30, i < 2048 ? 60 : 190, ++seq % 200, 255]).flat());
    await send('submit_commands', { commands: [
      { type: 'upload_source_frame', source_id: 'capture', width: 64, height: 64, rgba_b64: rgba.toString('base64'), seq },
      { type: 'upsert_layer', layer_id: 'capture', opacity: 1, z_index: 0, corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
      { type: 'bind_media_source', layer_id: 'capture', source_id: 'capture', uri: 'test://pixels', source_type: 'image' },
    ] });
    await send('frame_snapshot', { include_pixels: false });
    const reference = await send('output_shared_texture_snapshot', { include_pixels: true });
    const metadata = await send('output_shared_texture');
    expect(metadata.available).toBe(true);
    expect(reference.format.toLowerCase()).toContain('bgra');
    return { metadata, bytes: Buffer.from(reference.rgba_b64, 'base64'), width, height };
  }
  async function capture(reference: Awaited<ReturnType<typeof render>>) {
    let pixels: any;
    for (let i = 0; i < 100; i++) {
      pixels = addon.readSharedTexturePixels(reference.metadata.shared_name, reference.metadata.frame);
      if (pixels) break;
      await sleep(5);
    }
    expect(pixels).toBeTruthy();
    expect(pixels.width).toBe(reference.width); expect(pixels.height).toBe(reference.height);
    expect(pixels.data.equals(reference.bytes)).toBe(true);
    expect(pixels.data.length).toBe(reference.width * reference.height * 4);
    expect(pixels.frame).toBe(reference.metadata.frame);
  }
  try {
    const first = await render(65, 67); // Odd dimensions exercise GPU row padding.
    expect(addon.readSharedTexturePixels(first.metadata.shared_name, first.metadata.frame)).toBeNull();
    await capture(first);
    await capture(await render(65, 67));
    const resized = await render(131, 73);
    expect(resized.metadata.shared_name).not.toBe(first.metadata.shared_name);
    await capture(resized);
    addon.releaseReadback(); await capture(resized);
    expect(() => addon.readSharedTexturePixels('Local\\ghost-missing-test-texture', 1)).toThrow();
    await capture(resized);
    expect(() => addon.readSharedTexturePixels(resized.metadata.shared_name, NaN)).toThrow();
  } finally {
    addon.releaseReadback();
    try { await send('shutdown'); } finally { await closeNativeTestCore(child); }
  }
}, 60000);
