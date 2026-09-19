import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const binary = platform.binary;
type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function core() {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
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
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
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


const suite = platform.runnable && process.platform === 'darwin' ? describe : describe.skip;
suite('Native screen output capacity', () => {
  it('renders 32 outputs and preserves them after count, memory and duplicate-ID rejections', async () => {
    const rpc = core();
    const slices = Array.from({ length: 32 }, (_, i) => ({ id: `screen-${i}`, width: 64, height: 64 }));
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 64, height: 64, target_fps: 30 } });
      expect((await rpc.send('set_slice_outputs', { slices })).slices).toHaveLength(32);
      let state: any;
      for (let i = 0; i < 100; i++) {
        await rpc.commands([{ type: 'present' }]);
        state = await rpc.send('slice_output_state');
        if (state.slices?.length === 32 && state.slices.every((s: any) => s.frame > 0)) break;
        await sleep(50);
      }
      expect(state.available).toBe(true);
      expect(state.slices).toHaveLength(32);
      expect(state.slices.every((s: any) => s.frame > 0 && s.handle)).toBe(true);
      const rejected = await rpc.commands([{ type: 'set_slice_outputs', slices: [...slices, { id: 'extra', width: 64, height: 64 }] }]);
      expect(rejected.applied).toBe(0);
      expect(rejected.dropped).toBe(1);
      expect(rejected.errors[0].message).toContain('32');
      await expect(rpc.send('set_slice_outputs', { slices: slices.slice(0, 9).map(s => ({ ...s, width: 3840, height: 2160 })) })).rejects.toThrow('512 MiB');
      await expect(rpc.send('set_slice_outputs', { slices: [slices[0], slices[0]] })).rejects.toThrow('Duplicate');
      expect((await rpc.send('slice_output_state')).slices).toHaveLength(32);
      await rpc.send('set_slice_outputs', { slices: slices.slice(0, 2) });
      expect((await rpc.send('slice_output_state')).slices).toHaveLength(2);
      await rpc.send('set_slice_outputs', { slices: [] });
      expect((await rpc.send('slice_output_state')).slices).toHaveLength(0);
    } finally { await rpc.close(); }
  }, 30000);
});
