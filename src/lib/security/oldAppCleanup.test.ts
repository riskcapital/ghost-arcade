/**
 * Ghost Arcade Studio's offer to trash the old "Ghost Arcade.app" on macOS
 * (electron/old-app-cleanup.cjs). No real dialogs, nothing really trashed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { offerOldAppCleanup } = require('../../../electron/old-app-cleanup.cjs');

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function run(version: string) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ga-studio-cleanup-'));
  dirs.push(userDataDir);
  const ask = vi.fn(async () => ({ response: 0 }));
  const trash = vi.fn(async () => {});
  const go = () => offerOldAppCleanup({
    line: 'studio',
    productName: 'Ghost Arcade Studio',
    userDataDir,
    ownExePath: '/Applications/Ghost Arcade Studio.app/Contents/MacOS/Ghost Arcade Studio',
    ask,
    trash,
    platform: 'darwin',
    candidates: ['/Applications/Ghost Arcade.app'],
    readVersion: () => version,
  });
  return { ask, trash, go };
}

describe('Studio: old Ghost Arcade.app cleanup', () => {
  it('offers to trash an old 1.9 build, once', async () => {
    const t = run('1.9.996');
    await t.go();
    await t.go();
    expect(t.ask).toHaveBeenCalledTimes(1);
    expect(t.trash).toHaveBeenCalledWith('/Applications/Ghost Arcade.app');
  });

  it('leaves an old 2.x build alone: that one is Ghost Arcade Pro’s to replace', async () => {
    const t = run('2.1.2');
    await t.go();
    expect(t.ask).not.toHaveBeenCalled();
  });
});
