import { afterAll, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The main process keeps the last three launches' debug logs (electron/debug-log.cjs). */
const require = createRequire(import.meta.url);
const { debugLogLocation, rotatedLogName, rotateDebugLogs, startDebugLog } = require(join(process.cwd(), 'electron', 'debug-log.cjs'));

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

  it('the failed launch\'s log survives the next launch as .1', () => {
    const file = join(root, 'failure', 'ghost-arcade-debug.log');
    mkdirSync(join(root, 'failure'));
    startDebugLog(file, '=== launch A ===\n', rotateDebugLogs(file, 3));
    appendFileSync(file, '[Recovery] GAVE UP after 3 attempt(s)\n');
    startDebugLog(file, '=== launch B ===\n', rotateDebugLogs(file, 3));
    expect(readFileSync(rotatedLogName(file, 1), 'utf8')).toContain('GAVE UP');
    expect(readFileSync(file, 'utf8')).toBe('=== launch B ===\n');
  });

  it('reports whether the newest log was moved away', () => {
    const file = join(root, 'moved', 'ghost-arcade-debug.log');
    mkdirSync(join(root, 'moved'));
    expect(rotateDebugLogs(file, 3)).toBe(true); // nothing there yet
    writeFileSync(file, 'old');
    expect(rotateDebugLogs(file, 3)).toBe(true);
    const stuck = { existsSync: () => true, rmSync: () => {}, renameSync: () => { throw new Error('in use'); } };
    expect(rotateDebugLogs(file, 3, stuck)).toBe(false);
  });

  it('a log that could not be moved is appended to, not wiped', () => {
    const file = join(root, 'stuck.log');
    writeFileSync(file, 'the launch that failed\n');
    startDebugLog(file, '=== next launch ===\n', false);
    expect(readFileSync(file, 'utf8')).toBe('the launch that failed\n\n=== next launch ===\n');
  });

  it('a stuck log over the size cap starts afresh', () => {
    const file = join(root, 'huge.log');
    writeFileSync(file, 'x'.repeat(2048));
    startDebugLog(file, 'fresh\n', false, undefined, 1024);
    expect(readFileSync(file, 'utf8')).toBe('fresh\n');
  });
});
