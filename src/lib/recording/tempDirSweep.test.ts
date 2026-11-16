import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { markOwned, sweepStaleTempDirs, OWNER_FILE } = require('../../../electron/temp-dirs.cjs');
const fs = require('node:fs');

describe('stale temp folder sweep at launch', () => {
  it('removes only the app’s own kinds, a day untouched, not owned by a running process', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ga-sweep-'));
    try {
      const now = Date.now();
      const old = (now - 2 * 24 * 3600 * 1000) / 1000;
      const make = (name: string, { age = old, owner, file = true }: { age?: number; owner?: number; file?: boolean } = {}) => {
        const dir = path.join(root, name);
        mkdirSync(dir);
        if (file) writeFileSync(path.join(dir, 'frame.raw'), 'x');
        if (owner !== undefined) markOwned(fs, path, dir, owner);
        for (const f of [path.join(dir, 'frame.raw'), path.join(dir, OWNER_FILE)]) if (existsSync(f)) utimesSync(f, age, age);
        utimesSync(dir, age, age);
        return dir;
      };
      const killed = make('ghost-native-mp4-AAAAAA');
      const killedOwned = make('ghost-native-jpeg-BBBBBB', { owner: 999_999_001 });
      const running = make('ghost-native-mp4-CCCCCC', { owner: 4242 });
      const fresh = make('ghost-native-mp4-DDDDDD', { age: now / 1000 - 60 });
      const freshFile = make('ghost-show-audio-EEEEEE');
      utimesSync(path.join(freshFile, 'frame.raw'), now / 1000, now / 1000);
      const mine = make('ghost-render-core-frames-FFFFFF');
      const other = make('someone-else-GGGGGG');
      const removed = await sweepStaleTempDirs({ fs, path, root, now, inUse: new Set([mine]), isAlive: (pid: number) => pid === 4242 });
      expect(removed.sort()).toEqual([killed, killedOwned].sort());
      for (const dir of [killed, killedOwned]) expect(existsSync(dir)).toBe(false);
      for (const dir of [running, fresh, freshFile, mine, other]) expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a missing temp folder is no error', async () => {
    expect(await sweepStaleTempDirs({ fs, path, root: path.join(tmpdir(), 'ga-no-such-dir-xyz') })).toEqual([]);
  });
});
