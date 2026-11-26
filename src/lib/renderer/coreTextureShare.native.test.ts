import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * The render core publishes the program as a Syphon server itself
 * (native-renderer/src/texture_share.rs): started by name, it publishes
 * every rendered frame, renames in place, and stops on request.
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
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); },
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const full = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

const suite = platform.runnable && process.platform === 'darwin' ? describe : describe.skip;
suite('Syphon from the render core', () => {
  it('publishes rendered frames under the requested name and stops on request', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 640, height: 360, source_frame_size: 128, target_fps: 60 } });
      const caps = await rpc.send('capabilities').catch(() => null);
      if (caps) expect(caps.implemented_methods).toContain('texture_share_start');
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'c', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_color', layer_id: 'c', rgba: [1, 0, 0, 1] },
      ]);
      const started = await rpc.send('texture_share_start', { name: 'core-share-test', app_name: 'Ghost Arcade Test' });
      expect(started.available).toBe(true);
      for (let i = 0; i < 20; i++) {
        await rpc.commands([{ type: 'present' }]);
        await sleep(20);
      }
      const state = await rpc.send('texture_share_state');
      expect(state).toMatchObject({ active: true, platform: 'syphon', name: 'core-share-test', width: 640, height: 360 });
      expect(state.frames_published).toBeGreaterThan(5);
      expect(state.last_error).toBeNull();

      await rpc.send('texture_share_start', { name: 'core-share-renamed' });
      for (let i = 0; i < 5; i++) { await rpc.commands([{ type: 'present' }]); await sleep(20); }
      expect((await rpc.send('texture_share_state')).name).toBe('core-share-renamed');

      const stopped = await rpc.send('texture_share_stop');
      expect(stopped.active).toBe(false);
      await rpc.commands([{ type: 'present' }]);
      expect((await rpc.send('texture_share_state')).active).toBe(false);
    } finally { await rpc.close(); }
  }, 30000);

  it('refuses a start without a name', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 320, height: 180, source_frame_size: 128, target_fps: 30 } });
      await expect(rpc.send('texture_share_start', {})).rejects.toThrow(/needs a name/);
    } finally { await rpc.close(); }
  }, 30000);
});
