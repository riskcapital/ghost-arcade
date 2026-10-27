import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { replaceFile } = require('../../../electron/replace-file.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-replace-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function files(name: string) {
  const target = path.join(dir, name);
  const temp = `${target}.saving`;
  fs.writeFileSync(target, 'old');
  fs.writeFileSync(temp, 'new');
  return { target, temp };
}

/** fs whose rename fails with `code` for the first `failures` calls. */
function heldFs(code: string, failures: number) {
  let calls = 0;
  return {
    ...fs,
    renameSync(from: string, to: string) {
      if (calls++ < failures) throw Object.assign(new Error(`${code}: rename`), { code });
      fs.renameSync(from, to);
    },
  };
}

describe('replaceFile', () => {
  it('renames the finished file over the target', async () => {
    const { target, temp } = files('plain.gha');
    await replaceFile(temp, target);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(fs.existsSync(temp)).toBe(false);
  });

  it('on Windows, waits out a brief hold on the target', async () => {
    const { target, temp } = files('held.gha');
    await replaceFile(temp, target, { fs: heldFs('EPERM', 2), platform: 'win32', delays: [1, 1, 1] });
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(fs.existsSync(temp)).toBe(false);
  });

  it('on Windows, copies over a target that stays held', async () => {
    const { target, temp } = files('locked.gha');
    await replaceFile(temp, target, { fs: heldFs('EBUSY', 99), platform: 'win32', delays: [1, 1] });
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(fs.existsSync(temp)).toBe(false);
  });

  it('elsewhere, and for other errors, fails as the rename did', async () => {
    const { target, temp } = files('mac.gha');
    await expect(replaceFile(temp, target, { fs: heldFs('EPERM', 1), platform: 'darwin' })).rejects.toThrow('EPERM');
    await expect(replaceFile(temp, target, { fs: heldFs('ENOSPC', 1), platform: 'win32' })).rejects.toThrow('ENOSPC');
  });
});
