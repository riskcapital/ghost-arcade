import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCompositeEffectPassChainGraph,
  buildNativeEffectPassPrecompileCommands,
} from './nativeEffectPass';

/**
 * Runs a composition-FX chain on the real GPU.
 *
 * Composition FX used to reach the core only as inline colour maths inside
 * the compositor's single fullscreen pass, which has no texture to sample
 * neighbours from — so blur and everything like it was silently dropped and
 * users reported composition FX doing nothing. They now run as a real
 * effect-pass chain over a full-resolution copy of the finished composite.
 *
 * This drives that path end to end: the core must accept a graph whose
 * render target is the composite ping-pong, and render a frame with it
 * queued, without a shader error or a dropped frame.
 */

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
};

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout) throw new Error('native render-core stdio was not initialized');

  let nextId = 1;
  let stdout = '';
  const pending = new Map<number, {
    timer: ReturnType<typeof setTimeout>;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
          const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
          if (wait) {
            clearTimeout(wait.timer);
            pending.delete(message.id as number);
            if (message.ok) wait.resolve(message.result);
            else wait.reject(new Error(message.error || 'native rpc error'));
          }
        } catch {
          // non-JSON log line from the core — ignore
        }
      }
      index = stdout.indexOf('\n');
    }
  });

  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`native rpc timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, { timer, resolve, reject });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async close() {
      for (const [, wait] of pending) clearTimeout(wait.timer);
      pending.clear();
      child.kill();
    },
  };
}

const hasNativeCore = existsSync(nativeCoreBin);
const itIfNativeCore = hasNativeCore ? it : it.skip;
const nativeBackend = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'dx12' : 'vulkan';


describe('composition FX run as a post-composite pass on the native core', () => {
  itIfNativeCore('accepts a composite-target graph and renders with it', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 160, height: 90, source_frame_size: 160, target_fps: 60 },
      }, 20000);
      expect(started?.backend_ready).toBe(true);

      // The core must advertise the phase, otherwise the TS side correctly
      // refuses to use it and composition FX stay on the old colour ops.
      const caps = await rpc.send('capabilities', {}, 5000);
      expect(caps?.features?.native_post_composite_graph).toBe(true);

      for (const command of buildNativeEffectPassPrecompileCommands()) {
        await rpc.send('submit_commands', { commands: [command] }, 20000);
      }

      // Blur is the case that could never work before: it samples
      // neighbouring pixels, which the compositor's inline path cannot do.
      const graph = buildCompositeEffectPassChainGraph({
        sourceId: 'composite-frame:0',
        targetSourceId: 'composite-frame:1',
        effects: [
          { effect: 'blur', amount: 0.6, mix: 1, params: {} },
          { effect: 'brightness', amount: 1.2, mix: 1, params: {} },
        ],
        width: 160,
        height: 90,
        time: 0.5,
        frameIndex: 30,
        seq: 480,
      });

      await rpc.send('submit_commands', {
        commands: [{ type: 'queue_compute_graph', ...(graph.config as Record<string, unknown>) }],
      }, 20000);
      // submit_commands already auto-presents, and frame_snapshot forces a
      // render and reads the result back, so this exercises the whole
      // post-composite path rather than just the queueing.
      await rpc.send('frame_snapshot', {}, 20000);

      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error, JSON.stringify(status.last_shader_error)).toBeNull();
      expect(status.last_frame_error ?? null, JSON.stringify(status.last_frame_error)).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 60000);
});
