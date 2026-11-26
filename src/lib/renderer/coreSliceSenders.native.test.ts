import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * Screen senders published by the render core (native-renderer/src/
 * texture_share.rs): once switched on, every Screen whose spec carries a
 * sender name gets its own Syphon server, fed from the Screen's own target.
 */
type Command = Record<string, unknown>;
function core() {
  const env = { ...process.env, GA_SYPHON_FRAMEWORK: process.env.GA_SYPHON_FRAMEWORK ?? resolve('electron/native/vendor/Syphon.framework') };
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
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
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); },
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const W = 640;
const H = 360;

function screen(id: string, extra: Command = {}): Command {
  return { id, width: W / 2, height: H, cropX: 0, cropY: 0, cropW: 0.5, cropH: 1, warpMode: 'rect', ...extra };
}

/** A coordinate picture: red runs left to right, green top to bottom. */
function coordinateImage(size = 64) {
  const bytes: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) bytes.push(Math.round(x / (size - 1) * 255), Math.round(y / (size - 1) * 255), 0, 255);
  }
  return { type: 'upload_source_frame', source_id: 'coords', width: size, height: size, seq: 1, rgba_b64: Buffer.from(bytes).toString('base64') };
}

const suite = platform.runnable && process.platform === 'darwin' ? describe : describe.skip;
suite('Screen senders from the render core', () => {
  it('publishes one server per sender Screen, drops it when the Screen stops sending, and stops on request', async () => {
    const rpc = core();
    const present = async (n = 1) => { for (let i = 0; i < n; i++) { await rpc.commands([{ type: 'present' }]); await sleep(16); } };
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, source_frame_size: 128, target_fps: 60 } });
      expect((await rpc.send('capabilities')).implemented_methods).toEqual(expect.arrayContaining(['texture_share_slices_start', 'texture_share_slices_stop']));
      await rpc.commands([
        coordinateImage(),
        { type: 'upsert_layer', layer_id: 'coords', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'bind_media_source', layer_id: 'coords', source_id: 'coords', uri: 'test://image', source_type: 'image' },
      ]);
      const left = screen('left', { senderName: 'core-slice-left' });
      const right = screen('right', { cropX: 0.5, senderName: 'core-slice-right' });
      const plain = screen('plain');

      // Sender names alone publish nothing until the app switches it on.
      await rpc.send('set_slice_outputs', { slices: [left, right, plain] });
      await present(5);
      expect((await rpc.send('texture_share_state')).slices).toEqual([]);

      const started = await rpc.send('texture_share_slices_start', { app_name: 'Ghost Arcade Test' });
      expect(started.slices_enabled).toBe(true);
      await present(20);
      let state = await rpc.send('texture_share_state');
      expect(state.slice_errors).toEqual([]);
      const byId = Object.fromEntries(state.slices.map((s: any) => [s.id, s]));
      expect(Object.keys(byId).sort()).toEqual(['left', 'right']);
      expect(byId.left).toMatchObject({ name: 'core-slice-left', width: W / 2, height: H });
      expect(byId.right).toMatchObject({ name: 'core-slice-right', width: W / 2, height: H });
      expect(byId.left.frames_published).toBeGreaterThan(5);
      // The whole-output sender is separate and stays off.
      expect(state.active).toBe(false);

      // A renamed sender is a new server under the new name; a Screen that
      // stops sending loses its server.
      await rpc.send('set_slice_outputs', { slices: [{ ...left, senderName: 'core-slice-left-2' }, { ...right, senderName: undefined }, plain] });
      await present(5);
      state = await rpc.send('texture_share_state');
      expect(state.slices.map((s: any) => [s.id, s.name])).toEqual([['left', 'core-slice-left-2']]);

      const stopped = await rpc.send('texture_share_slices_stop');
      expect(stopped.slices_enabled).toBe(false);
      expect(stopped.slices).toEqual([]);
      await present(3);
      expect((await rpc.send('texture_share_state')).slices).toEqual([]);
    } finally { await rpc.close(); }
  }, 60000);
});
