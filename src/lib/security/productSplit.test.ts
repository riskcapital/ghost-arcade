/**
 * Ghost Arcade Pro beside Ghost Arcade Studio: the first-launch settings copy
 * (electron/profile-migration.cjs) and the offer to trash the old
 * "Ghost Arcade.app" (electron/old-app-cleanup.cjs). Real temp folders, no
 * real dialogs, nothing moved to the real Trash.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { migrateProfile, MARKER } = require('../../../electron/profile-migration.cjs');
const { offerOldAppCleanup, belongsToLine } = require('../../../electron/old-app-cleanup.cjs');

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ga-split-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function oldProfile() {
  const from = join(tempDir(), 'Ghost Arcade');
  mkdirSync(join(from, 'Local Storage', 'leveldb'), { recursive: true });
  writeFileSync(join(from, 'Local Storage', 'leveldb', '000003.log'), 'settings');
  mkdirSync(join(from, 'shaders'));
  writeFileSync(join(from, 'shaders', 'mine.fs'), 'void main(){}');
  writeFileSync(join(from, 'path-grants.json'), '{}');
  writeFileSync(join(from, 'remote-pairing.json'), '{"token":"OLD"}');
  mkdirSync(join(from, 'project-assets'));
  writeFileSync(join(from, 'project-assets', 'clip.mp4'), 'video');
  mkdirSync(join(from, 'GPUCache'));
  writeFileSync(join(from, 'SingletonLock'), '');
  return from;
}

describe('first-launch settings copy', () => {
  it('copies settings, shaders and file permissions, but not media, pairing or caches', () => {
    const from = oldProfile();
    const to = join(tempDir(), 'Ghost Arcade Pro');
    const result = migrateProfile({ from, to });
    expect(result.migrated).toBe(true);
    expect(readFileSync(join(to, 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('settings');
    expect(existsSync(join(to, 'shaders', 'mine.fs'))).toBe(true);
    expect(existsSync(join(to, 'path-grants.json'))).toBe(true);
    expect(existsSync(join(to, 'remote-pairing.json'))).toBe(false);
    expect(existsSync(join(to, 'project-assets'))).toBe(false);
    expect(existsSync(join(to, 'GPUCache'))).toBe(false);
    expect(existsSync(join(to, 'SingletonLock'))).toBe(false);
    // The old folder is left exactly as it was: Studio still uses it.
    expect(existsSync(join(from, 'remote-pairing.json'))).toBe(true);
    expect(existsSync(join(from, 'project-assets', 'clip.mp4'))).toBe(true);
  });

  it('runs once: a second launch copies nothing, even after Studio changes its settings', () => {
    const from = oldProfile();
    const to = join(tempDir(), 'Ghost Arcade Pro');
    migrateProfile({ from, to });
    writeFileSync(join(from, 'shaders', 'later.fs'), 'x');
    expect(migrateProfile({ from, to })).toMatchObject({ migrated: false, reason: 'already-done' });
    expect(existsSync(join(to, 'shaders', 'later.fs'))).toBe(false);
  });

  it('never overwrites a Pro profile that is already in use', () => {
    const from = oldProfile();
    const to = join(tempDir(), 'Ghost Arcade Pro');
    mkdirSync(join(to, 'Local Storage'), { recursive: true });
    expect(migrateProfile({ from, to })).toMatchObject({ migrated: false, reason: 'target-in-use' });
    expect(existsSync(join(to, 'shaders'))).toBe(false);
    expect(existsSync(join(to, MARKER))).toBe(true);
  });

  it('a fresh machine with no old folder just records that it checked', () => {
    const to = join(tempDir(), 'Ghost Arcade Pro');
    expect(migrateProfile({ from: join(tempDir(), 'missing'), to })).toMatchObject({ migrated: false, reason: 'no-source' });
    expect(existsSync(join(to, MARKER))).toBe(true);
  });
});

describe('old Ghost Arcade.app cleanup', () => {
  it('each product only claims its own line', () => {
    expect(belongsToLine('2.1.2', 'pro')).toBe(true);
    expect(belongsToLine('1.9.996', 'pro')).toBe(false);
    expect(belongsToLine('1.9.996', 'studio')).toBe(true);
    expect(belongsToLine('2.1.2', 'studio')).toBe(false);
    expect(belongsToLine('junk', 'studio')).toBe(false);
  });

  function run(overrides: Record<string, unknown> = {}) {
    const userDataDir = tempDir();
    const ask = vi.fn(async () => ({ response: 0 }));
    const trash = vi.fn(async () => {});
    const base = {
      line: 'pro',
      productName: 'Ghost Arcade Pro',
      userDataDir,
      ownExePath: '/Applications/Ghost Arcade Pro.app/Contents/MacOS/Ghost Arcade Pro',
      ask,
      trash,
      platform: 'darwin',
      candidates: ['/Applications/Ghost Arcade.app'],
      readVersion: () => '2.1.2',
    };
    return { ask, trash, userDataDir, go: (more: Record<string, unknown> = {}) => offerOldAppCleanup({ ...base, ...overrides, ...more }) };
  }

  it('asks, then trashes on yes, and does not ask again for that version', async () => {
    const t = run();
    const first = await t.go();
    expect(t.ask).toHaveBeenCalledTimes(1);
    expect(t.trash).toHaveBeenCalledWith('/Applications/Ghost Arcade.app');
    expect(first.offered[0]).toMatchObject({ version: '2.1.2', trashed: true });
    await t.go();
    expect(t.ask).toHaveBeenCalledTimes(1);
  });

  it('Keep leaves the app alone', async () => {
    const t = run();
    t.ask.mockResolvedValueOnce({ response: 1 });
    await t.go();
    expect(t.trash).not.toHaveBeenCalled();
  });

  it('Pro never offers to remove an old 1.9 build, which is Studio’s to replace', async () => {
    const t = run({ readVersion: () => '1.9.996' });
    await t.go();
    expect(t.ask).not.toHaveBeenCalled();
  });

  it('never runs off macOS, and never offers the running app itself', async () => {
    const t = run({ platform: 'win32' });
    await t.go();
    const self = run({ ownExePath: '/Applications/Ghost Arcade.app/Contents/MacOS/Ghost Arcade' });
    await self.go();
    expect(t.ask).not.toHaveBeenCalled();
    expect(self.ask).not.toHaveBeenCalled();
  });
});
