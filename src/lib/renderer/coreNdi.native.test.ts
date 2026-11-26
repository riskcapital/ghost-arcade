import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * NDI senders from the render core (native-renderer/src/ndi_out.rs): the
 * program and NDI sender Screens, sent from the core's own textures, with
 * the NDI runtime opened at run time. Without the runtime the core still
 * runs and says why it cannot send.
 */
type Command = Record<string, unknown>;
function core(env: Record<string, string> = {}) {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
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
const start = { config: { backend: platform.rendererBackend, width: W, height: H, source_frame_size: 128, target_fps: 60 } };

function screen(id: string, extra: Command = {}): Command {
  return { id, width: W / 2, height: H, cropX: 0, cropY: 0, cropW: 0.5, cropH: 1, warpMode: 'rect', ...extra };
}

const suite = platform.runnable && (process.platform === 'darwin' || process.platform === 'win32') ? describe : describe.skip;
suite('NDI from the render core', () => {
  it('keeps running without the NDI runtime and says why it cannot send', async () => {
    const rpc = core({ GA_NDI_RUNTIME: '/nonexistent/ndi-runtime-for-test' });
    try {
      await rpc.send('start', start);
      expect((await rpc.send('capabilities')).implemented_methods).toEqual(expect.arrayContaining(['ndi_send_start', 'ndi_slices_start', 'ndi_state']));
      const probe = await rpc.send('ndi_state', { probe: true });
      expect(probe).toMatchObject({ implemented: true, available: false, active: false });
      expect(probe.runtime_error).toMatch(/NDI runtime not found/);
      await expect(rpc.send('ndi_send_start', { name: 'core-ndi-test' })).rejects.toThrow(/NDI runtime not found/);
      await expect(rpc.send('ndi_slices_start', {})).rejects.toThrow(/NDI runtime not found/);
      // Still rendering.
      await rpc.commands([{ type: 'present' }]);
      expect((await rpc.send('ndi_state')).wanted).toBeNull();
    } finally { await rpc.close(); }
  }, 30000);

  it('opens the program and Screen senders by name and stops them on request', async () => {
    const rpc = core();
    const present = async (n = 1) => { for (let i = 0; i < n; i++) { await rpc.commands([{ type: 'present' }]); await sleep(16); } };
    try {
      await rpc.send('start', start);
      const probe = await rpc.send('ndi_state', { probe: true });
      if (probe.available !== true) {
        // No NDI runtime on this machine: the case above covers it.
        console.warn(`NDI runtime not installed, sender test skipped: ${probe.runtime_error}`);
        return;
      }
      await expect(rpc.send('ndi_send_start', {})).rejects.toThrow(/needs a name/);
      await rpc.commands([
        { type: 'upsert_layer', layer_id: 'c', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
        { type: 'set_layer_color', layer_id: 'c', rgba: [1, 0, 0, 1] },
      ]);
      await rpc.send('set_slice_outputs', { slices: [screen('left', { ndiName: 'core-ndi-left' }), screen('right', { cropX: 0.5, ndiName: 'core-ndi-right' }), screen('plain')] });
      // NDI names alone open nothing until the app switches Screen senders on.
      await present(3);
      expect((await rpc.send('ndi_state')).slices).toEqual([]);

      const started = await rpc.send('ndi_send_start', { name: 'core-ndi-program', fps: 30 });
      expect(started).toMatchObject({ available: true, wanted: 'core-ndi-program' });
      expect((await rpc.send('ndi_slices_start', { fps: 30 })).slices_enabled).toBe(true);
      await present(10);
      let state = await rpc.send('ndi_state');
      expect(state).toMatchObject({ active: true, name: 'core-ndi-program', fps_target: 30, last_error: null });
      expect(state.slice_errors).toEqual([]);
      expect(state.slices.map((s: any) => [s.id, s.name]).sort()).toEqual([['left', 'core-ndi-left'], ['right', 'core-ndi-right']]);
      // Nobody receives here, so nothing is read back.
      expect(state.connections).toBe(0);
      expect(state.frames_captured).toBe(0);

      // Renamed: a new sender under the new name. A Screen that stops
      // sending loses its sender.
      await rpc.send('ndi_send_start', { name: 'core-ndi-program-2', fps: 30 });
      await rpc.send('set_slice_outputs', { slices: [screen('left', { ndiName: 'core-ndi-left' }), screen('right', { cropX: 0.5 })] });
      await present(3);
      state = await rpc.send('ndi_state');
      expect(state.name).toBe('core-ndi-program-2');
      expect(state.slices.map((s: any) => s.id)).toEqual(['left']);

      expect((await rpc.send('ndi_slices_stop')).slices).toEqual([]);
      const stopped = await rpc.send('ndi_send_stop');
      expect(stopped.active).toBe(false);
      await present(2);
      expect((await rpc.send('ndi_state')).active).toBe(false);
    } finally { await rpc.close(); }
  }, 30000);
});
