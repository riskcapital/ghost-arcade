import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * download_update_installer fetched any URL into userData/updates and
 * launch_update_installer opened it (running it on Windows). Nothing in the
 * app called either, so both are removed rather than restricted.
 */

const electronDir = join(process.cwd(), 'electron');
const mainSource = readFileSync(join(electronDir, 'main.js'), 'utf8');
const preloadSource = readFileSync(join(electronDir, 'preload.cjs'), 'utf8');

describe('update installer handlers', () => {
  it('are gone from the main process and the preload allowlist', () => {
    for (const name of ['download_update_installer', 'launch_update_installer']) {
      expect(mainSource, name).not.toContain(name);
      expect(preloadSource, name).not.toContain(name);
    }
    expect(mainSource).not.toContain('update-download-progress');
    expect(preloadSource).not.toContain('update-download-progress');
  });
});
