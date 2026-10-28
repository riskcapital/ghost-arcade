import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A core that exits while a request is being written to it breaks the pipe:
 * the write fails with EPIPE a moment before the process's exit is seen.
 * Which of the two the broker heard first decided what the editor showed,
 * and the pipe's own error event had no listener, so the loser threw.
 */
const fake = vi.hoisted(() => ({ state: { exitCode: 101 as number | null } }));

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { state } = fake;
  class FakeCore extends EventEmitter {
    killed = false;
    stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    stdin = Object.assign(new EventEmitter(), {
      writable: true,
      write: (_payload: string, callback?: (error?: Error) => void) => {
        const broken = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' });
        setImmediate(() => {
          callback?.(broken);
          this.stdin.emit('error', broken);
          // The process's exit arrives after the failed write.
          const exitCode = state.exitCode;
          if (exitCode !== null) setTimeout(() => this.emit('exit', exitCode, null), 20);
        });
        return true;
      },
    });
    kill() { this.killed = true; return true; }
  }
  return { spawn: vi.fn(() => new FakeCore()) };
});

// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

const dir = mkdtempSync(join(tmpdir(), 'ga-core-pipe-'));
const executable = join(dir, 'ghost-render-core');
writeFileSync(executable, '');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function broker() {
  return createNativeRendererBroker({
    appRoot: dir,
    resourcesPath: dir,
    isPackaged: false,
    platform: 'linux',
    env: { GA_NATIVE_RENDER_CORE_PATH: executable, GA_FFMPEG_PATH: '/bin/false' },
  });
}

describe('a request written as the core exits', () => {
  it('ends with the reason the core stopped, not the broken pipe', async () => {
    fake.state.exitCode = 101;
    const b = broker();
    await expect(b.start({})).rejects.toThrow(/render core stopped \(exit code 101\)/);
    const status = await b.getStatus();
    expect(status.core_exited_unexpectedly).toBe(true);
    expect(status.core_exit_code).toBe(101);
    b.shutdownSync();
  });

  it('falls back to the write error when the core does not exit', async () => {
    fake.state.exitCode = null;
    const b = broker();
    await expect(b.start({})).rejects.toThrow(/EPIPE/);
    b.shutdownSync();
  });
});
