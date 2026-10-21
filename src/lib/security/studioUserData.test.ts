/**
 * Where Ghost Arcade Studio keeps its data (electron/user-data-folder.cjs):
 * the "ghost-arcade" folder every earlier version used.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { studioUserDataFolder } = require('../../../electron/user-data-folder.cjs');

const appData = '/Users/x/Library/Application Support';
const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe('Studio data folder', () => {
  it('uses ghost-arcade, the folder 1.9 and every earlier version used', () => {
    expect(studioUserDataFolder(appData, has(join(appData, 'ghost-arcade')))).toBe(join(appData, 'ghost-arcade'));
  });

  it('goes back to ghost-arcade after Studio 2.0.0 made a new folder beside it', () => {
    const exists = has(join(appData, 'ghost-arcade'), join(appData, 'Ghost Arcade', 'Local Storage'));
    expect(studioUserDataFolder(appData, exists)).toBe(join(appData, 'ghost-arcade'));
  });

  it('keeps the 2.0.0 folder for someone who started on 2.0.0', () => {
    expect(studioUserDataFolder(appData, has(join(appData, 'Ghost Arcade', 'Local Storage')))).toBe(join(appData, 'Ghost Arcade'));
  });

  it('a fresh install starts in ghost-arcade', () => {
    expect(studioUserDataFolder(appData, has())).toBe(join(appData, 'ghost-arcade'));
  });
});
