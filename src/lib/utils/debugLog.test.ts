import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The main process keeps the last three launches' debug logs (electron/debug-log.cjs). */
const require = createRequire(import.meta.url);
const { debugLogLocation, rotatedLogName, rotateDebugLogs } = require(join(process.cwd(), 'electron', 'debug-log.cjs'));

const root = mkdtempSync(join(tmpdir(), 'ga-debug-log-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('debug log rotation', () => {
  it('keeps the documented name for the packaged app', () => {
    expect(debugLogLocation({ packaged: true, platform: 'darwin', env: { HOME: '/Users/a' }, sourceRoot: '/src' }).file)
      .toBe(join('/Users/a', 'Library', 'Logs', 'ghost-arcade-debug.log'));
    expect(debugLogLocation({ packaged: true, platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/a/AppData/Local' }, sourceRoot: '/src' }).file)
      .toBe(join('C:/Users/a/AppData/Local', 'ghost-arcade-debug.log'));
    expect(debugLogLocation({ packaged: false, platform: 'darwin', env: {}, sourceRoot: '/src' }).file)
      .toBe(join('/src', 'electron-debug.log'));
  });

  it('names older logs .1 and .2', () => {
    expect(rotatedLogName('/l/ghost-arcade-debug.log', 0)).toBe('/l/ghost-arcade-debug.log');
    expect(rotatedLogName('/l/ghost-arcade-debug.log', 2)).toBe('/l/ghost-arcade-debug.2.log');
  });

  it('shifts the last launches down and drops the oldest', () => {
    const file = join(root, 'ghost-arcade-debug.log');
    const launch = (n: number) => { rotateDebugLogs(file, 3); writeFileSync(file, `launch ${n}`); };
    for (let n = 1; n <= 4; n += 1) launch(n);
    expect(readFileSync(file, 'utf8')).toBe('launch 4');
    expect(readFileSync(rotatedLogName(file, 1), 'utf8')).toBe('launch 3');
    expect(readFileSync(rotatedLogName(file, 2), 'utf8')).toBe('launch 2');
    expect(existsSync(rotatedLogName(file, 3))).toBe(false);
  });

  it('never throws when a log cannot be moved', () => {
    const failing = {
      existsSync: () => true,
      rmSync: () => { throw new Error('busy'); },
      renameSync: () => { throw new Error('busy'); },
    };
    expect(() => rotateDebugLogs(join(root, 'locked.log'), 3, failing)).not.toThrow();
  });
});
