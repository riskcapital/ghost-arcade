import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker, describeNativeCoreExit } from '../../../electron/native-renderer-broker.js';

/**
 * A render core that stops on its own used to surface only in the log
 * ("Native render core exited (3221225781)") while the workspace waited for a
 * frame forever. The broker now says why, in words, and marks the status so
 * the editor can show it and restart the core.
 */
const dir = mkdtempSync(join(tmpdir(), 'ga-core-exit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeCore(name: string, script: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

function brokerFor(executable: string) {
  return createNativeRendererBroker({
    appRoot: dir,
    resourcesPath: dir,
    isPackaged: false,
    platform: process.platform,
    env: { ...process.env, GA_NATIVE_RENDER_CORE_PATH: executable, GA_FFMPEG_PATH: '/bin/false' },
  });
}

describe('render core exit reporting', () => {
  it('names a missing Windows DLL and points at the Media Feature Pack', () => {
    const failure = describeNativeCoreExit({ code: 3221225781, signal: null, platform: 'win32' });
    expect(failure.message).toContain('0xC0000135');
    expect(failure.hint).toContain('Media Feature Pack');
    // Node reports the same NTSTATUS as a negative number on some paths.
    expect(describeNativeCoreExit({ code: -1073741515, platform: 'win32' }).message).toContain('0xC0000135');
  });

  it('gives a plain hint for crashes, kills and spawn failures', () => {
    expect(describeNativeCoreExit({ code: 0xC0000005 }).hint).toMatch(/graphics driver/);
    expect(describeNativeCoreExit({ code: null, signal: 'SIGKILL' }).hint).toMatch(/memory/);
    expect(describeNativeCoreExit({ spawnError: Object.assign(new Error('denied'), { code: 'EACCES' }) }).hint)
      .toMatch(/security software/);
  });

  it.skipIf(process.platform === 'win32')('rejects start with the reason and marks the status when the core exits', async () => {
    const broker = brokerFor(fakeCore('dies.sh', 'exit 101'));
    await expect(broker.start({})).rejects.toThrow(/render core stopped \(exit code 101\)/);
    const status = await broker.getStatus();
    expect(status.running).toBe(false);
    expect(status.core_exited_unexpectedly).toBe(true);
    expect(status.core_exit_code).toBe(101);
    expect(status.core_instance).toBe(1);
    expect(status.core_failure_hint).toMatch(/Retry/);
    broker.shutdownSync();
  });

  it.skipIf(process.platform === 'win32')('counts a respawn as a new core and clears the old failure', async () => {
    const broker = brokerFor(fakeCore('dies-again.sh', 'exit 3'));
    await expect(broker.start({})).rejects.toThrow();
    await expect(broker.start({})).rejects.toThrow();
    const status = await broker.getStatus();
    expect(status.core_instance).toBe(2);
    await broker.stop();
    const stopped = await broker.getStatus();
    // An intended stop is not a failure the editor should report.
    expect(stopped.core_exited_unexpectedly).toBe(false);
    broker.shutdownSync();
  });
});
