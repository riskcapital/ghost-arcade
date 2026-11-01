/**
 * The Studio's visual voices are written for the native path, which has the
 * full GLSL function set. The browser preview and thumbnails compile them as
 * GLSL ES 1.0 (WebGL1), which lacks some: each one used must come with a
 * polyfill, and an #extension line must come before anything else.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseISF } from './parser';

const dir = join(process.cwd(), 'public', 'ISF');
const voices = readdirSync(dir).filter((f) => /^VX-.*\.fs$/.test(f));

/** Functions GLSL ES 1.0 lacks, with the definition the conversion must add when one is used. */
const MISSING: Record<string, RegExp> = {
  tanh: /\bfloat\s+tanh\s*\(\s*float/,
  sinh: /\bfloat\s+sinh\s*\(/,
  cosh: /\bfloat\s+cosh\s*\(/,
  round: /\bfloat\s+round\s*\(/,
  trunc: /\bfloat\s+trunc\s*\(/,
  inverse: /\bmat\d\s+inverse\s*\(/,
  transpose: /\bmat\d\s+transpose\s*\(/,
};

describe('visual voices on WebGL1', () => {
  it('finds the voices', () => {
    expect(voices.length).toBeGreaterThan(40);
  });

  for (const file of voices) {
    it(`${file} has everything GLSL ES 1.0 needs`, () => {
      const glsl = parseISF(readFileSync(join(dir, file), 'utf8')).fragmentShader;
      for (const [fn, definition] of Object.entries(MISSING)) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(glsl)) expect(definition.test(glsl), `${file} uses ${fn}()`).toBe(true);
      }
      const ext = glsl.indexOf('#extension');
      if (ext >= 0) expect(glsl.slice(0, ext).trim(), `${file}: #extension must come first`).toBe('');
    });
  }
});
