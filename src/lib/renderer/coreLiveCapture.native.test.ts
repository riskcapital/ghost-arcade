import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * The render core runs a screen capture itself (native-renderer/src/
 * live_capture.rs) and feeds a bound layer source from it, without the
 * editor sending frames. Needs Screen Recording permission for whoever
 * launched the test; without it the capture case is skipped.
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
const config = { backend: platform.rendererBackend, width: 640, height: 360, source_frame_size: 256, target_fps: 60 };

const suite = platform.runnable && process.platform === 'darwin' ? describe : describe.skip;
suite('Live capture in the render core', () => {
  it('reports its methods and refuses bad requests', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config });
      const caps = await rpc.send('capabilities');
      expect(caps.implemented_methods).toEqual(expect.arrayContaining(['live_capture_start', 'live_capture_stop', 'live_capture_state', 'live_capture_list_cameras']));
      expect(caps.native_features?.native_live_capture ?? true).toBe(true);
      expect(Array.isArray(await rpc.send('live_capture_list_cameras'))).toBe(true);
      await expect(rpc.send('live_capture_start', { kind: 'screen', source_id: 'screen:1:0' })).rejects.toThrow(/session_id/);
      await expect(rpc.send('live_capture_start', { session_id: 's', kind: 'microphone' })).rejects.toThrow(/unknown kind/);
      expect(await rpc.send('live_capture_stop', { session_id: 'never-started' })).toMatchObject({ stopped: false });
    } finally { await rpc.close(); }
  }, 30000);

  it('feeds a bound source from a screen capture, and lets an editor upload take it back', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config });
      const permissions = (await rpc.send('live_capture_state')).permissions;
      if (permissions?.screen !== 'granted') {
        console.warn('[coreLiveCapture] Screen Recording not granted to this process; skipping the capture check');
        return;
      }
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'cap', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'bind_media_source', layer_id: 'cap', source_id: 'cap-src', uri: 'live://capture/core-test', source_type: 'capture' },
      ]);
      await rpc.send('live_capture_start', { session_id: 'core-test', kind: 'screen', source_id: 'screen:0:0', display_id: '' });
      await rpc.commands([{ type: 'bind_live_capture_source', source_id: 'cap-src', session_id: 'core-test', seq: 1 }]);
      let session: any = null;
      for (let i = 0; i < 100; i++) {
        session = (await rpc.send('live_capture_state', { session_id: 'core-test' })).session;
        if (session?.sources?.[0]?.imports > 1 || session?.failed) break;
        await sleep(50);
      }
      expect(session?.error ?? null).toBeNull();
      expect(session.running).toBe(true);
      expect(session.sources[0].imports).toBeGreaterThan(1);
      expect(session.width).toBeGreaterThan(0);
      const readiness = await rpc.send('get_layer_source_readiness', { layer_id: 'cap' });
      expect(readiness.ready).toBe(true);

      // An editor upload for the source (the addon fallback) unbinds it.
      await rpc.commands([{ type: 'upload_source_frame', source_id: 'cap-src', width: 2, height: 2, seq: 2,
        rgba_b64: Buffer.from(new Uint8Array(16).fill(255)).toString('base64') }]);
      const after = (await rpc.send('live_capture_state', { session_id: 'core-test' })).session;
      const imports = after.sources.length ? after.sources[0].imports : 0;
      await sleep(200);
      const later = (await rpc.send('live_capture_state', { session_id: 'core-test' })).session;
      expect(later.sources.length ? later.sources[0].imports : 0).toBe(imports);

      expect(await rpc.send('live_capture_stop', { session_id: 'core-test' })).toMatchObject({ stopped: true });
      expect((await rpc.send('live_capture_state', { session_id: 'core-test' })).session).toBeNull();
    } finally { await rpc.close(); }
  }, 30000);
});
