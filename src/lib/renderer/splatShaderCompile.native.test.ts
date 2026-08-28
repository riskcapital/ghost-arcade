import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSplatNativePrecompileCommands } from './splatNative';

/**
 * Compiles the splat WGSL on the real GPU via the native core.
 *
 * splatNative.native.test.ts only asserts the graph's STRUCTURE — it never
 * hands the shader source to wgpu, so a WGSL syntax or type error there
 * survives the whole suite and only surfaces as a black layer at runtime.
 * This closes that gap: every splat shader/entry point the renderer will
 * ever precompile gets compiled here, and `last_shader_error` must be null.
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

describe('splat WGSL compiles on the native core', () => {
  itIfNativeCore('precompiles every splat shader entry without error', async () => {
    const rpc = createNativeRpc();
    try {
      const started = await rpc.send('start', {
        config: { backend: nativeBackend, width: 160, height: 90, source_frame_size: 160, target_fps: 60 },
      }, 20000);
      expect(started?.backend_ready).toBe(true);

      const commands = buildSplatNativePrecompileCommands();
      expect(commands.length).toBeGreaterThan(0);

      for (const command of commands) {
        const result = await rpc.send('submit_commands', { commands: [command] }, 20000);
        const status = await rpc.send('status', {}, 5000);
        expect(
          status.last_shader_error,
          `${(command as any).shader_id}/${(command as any).entry}: ${JSON.stringify(result)}`,
        ).toBeNull();
      }
    } finally {
      await rpc.close();
    }
  }, 60000);
});
