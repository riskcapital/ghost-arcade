import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bundled assets must be referenced relative to BASE_URL, never root-absolute.
 *
 * vite.config.ts sets `base: './'` because Electron loads the app over
 * file://, where a root-absolute '/threejs/...' resolves against the
 * filesystem root rather than the app bundle. Vite rewrites its own imports,
 * but a hardcoded string in source is emitted verbatim and slips past that.
 *
 * The failure only appears in a packaged build — under the dev server the
 * root-absolute path resolves fine — so it survives every local test and
 * reaches users instead. Reported against the Embryo asset by an external
 * contributor (PR #16).
 */

const COMPONENTS = join(process.cwd(), 'src', 'lib', 'components');

/** Public directories shipped in the bundle and loaded at runtime. */
const BUNDLED_DIRS = ['threejs', 'p5js', 'ISF', 'shaders', 'models'];

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return svelteFiles(full);
    return entry.endsWith('.svelte') ? [full] : [];
  });
}

describe('bundled asset paths', () => {
  it('never references a bundled directory root-absolutely', () => {
    const pattern = new RegExp(`['"\`]/(${BUNDLED_DIRS.join('|')})/`);
    const offenders: string[] = [];

    for (const file of svelteFiles(COMPONENTS)) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (pattern.test(line)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      'root-absolute asset paths break under file:// in packaged builds; '
      + 'use `${import.meta.env.BASE_URL}...` instead:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('keeps the relative base that makes this necessary', () => {
    // If base stops being './', the whole premise changes and this rule
    // should be revisited rather than silently kept.
    const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/base:\s*'\.\/'/);
  });
});
