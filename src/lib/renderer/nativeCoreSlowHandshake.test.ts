import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * On a slow first launch (a software Vulkan driver compiling its first
 * pipelines) the core answers `start`, then takes seconds over the capability
 * handshake. The editor's panels poll capabilities meanwhile; one of those
 * polls timing out marked the backend not ready, and start() handed that
 * verdict to the editor after the handshake had succeeded. The editor's sync
 * starts once, so the composite stayed black for the session.
 */
const fake = vi.hoisted(() => ({ sent: [] as string[], capabilitiesDelayMs: 1500 }));

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeCore extends EventEmitter {
    killed = false;
    stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    stdin = Object.assign(new EventEmitter(), {
      writable: true,
      write: (payload: string, callback?: (error?: Error | null) => void) => {
        for (const line of String(payload).split('\n').filter(Boolean)) {
          const { id, method } = JSON.parse(line);
          fake.sent.push(method);
          const reply = (result: unknown) => this.stdout.emit('data', `${JSON.stringify({ id, ok: true, result })}\n`);
          if (method === 'get_capabilities') {
            setTimeout(() => reply({ features: {}, implemented_methods: ['status', 'get_capabilities'] }), fake.capabilitiesDelayMs);
          } else if (method === 'start') {
            setImmediate(() => reply({ running: true, backend: 'vulkan', backend_ready: true, adapter_name: 'Test GPU' }));
          } else {
            setImmediate(() => reply({}));
          }
        }
        setImmediate(() => callback?.(null));
        return true;
      },
    });
    kill() { this.killed = true; return true; }
  }
  return { spawn: vi.fn(() => new FakeCore()) };
});

// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

const dir = mkdtempSync(join(tmpdir(), 'ga-core-handshake-'));
const executable = join(dir, 'ghost-render-core');
writeFileSync(executable, '');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a slow capability handshake', () => {
  it('still starts the backend when a routine poll gave up before it answered', async () => {
    const broker = createNativeRendererBroker({
      appRoot: dir,
      resourcesPath: dir,
      isPackaged: false,
      platform: 'linux',
      env: { GA_NATIVE_RENDER_CORE_PATH: executable, GA_FFMPEG_PATH: '/bin/false' },
    });
    const starting = broker.start({});
    await vi.waitFor(() => expect(fake.sent).toContain('get_capabilities'), { timeout: 3000 });
    // An editor panel asks as well, and gives up after a second.
    await broker.invoke('native_renderer_get_capabilities');
    const status = await starting;
    expect(status.backend_ready).toBe(true);
    expect(String(status.last_frame_error ?? '')).not.toMatch(/handshake failed/);
    const capabilities = await broker.invoke('native_renderer_get_capabilities');
    expect(capabilities.core_capabilities_confirmed).toBe(true);
    broker.shutdownSync();
  });
});
