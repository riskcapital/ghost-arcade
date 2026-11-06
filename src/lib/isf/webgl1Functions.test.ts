/**
 * Shaders are compiled as GLSL ES 1.0 (WebGL1), which lacks some functions
 * desktop GLSL has. Each one a shader uses must come with a definition, and
 * an #extension line must come before anything else.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseISF } from './parser';

const shader = (body: string) => `/*{ "ISFVSN": "2", "INPUTS": [] }*/\n${body}`;

describe('ISF on WebGL1', () => {
  it('adds tanh and round when a shader uses them', () => {
    const glsl = parseISF(shader('void main(){ float a = tanh(1.0); vec2 b = round(vec2(1.4)); gl_FragColor = vec4(a, b, 1.0); }')).fragmentShader;
    expect(glsl).toMatch(/\bfloat\s+tanh\s*\(\s*float/);
    expect(glsl).toMatch(/\bvec2\s+round\s*\(\s*vec2/);
  });

  it('adds transpose for a shader that inverts a rotation', () => {
    const glsl = parseISF(shader('void main(){ mat2 r = mat2(0.0, 1.0, -1.0, 0.0); vec2 p = transpose(r) * isf_FragNormCoord; gl_FragColor = vec4(p, 0.0, 1.0); }')).fragmentShader;
    expect(glsl).toMatch(/\bmat2\s+transpose\s*\(\s*mat2/);
    expect(glsl).toMatch(/\bmat3\s+transpose\s*\(\s*mat3/);
  });

  it('leaves a shader that defines its own alone, and adds nothing unused', () => {
    const own = parseISF(shader('float tanh(float x) { return x; }\nvoid main(){ gl_FragColor = vec4(tanh(0.5)); }')).fragmentShader;
    expect(own.match(/\bfloat\s+tanh\s*\(/g)).toHaveLength(1);
    const plain = parseISF(shader('void main(){ gl_FragColor = vec4(1.0); }')).fragmentShader;
    expect(plain).not.toMatch(/\b(tanh|round|transpose)\s*\(/);
  });

  it('puts the derivatives extension above everything', () => {
    const glsl = parseISF(shader('void main(){ float w = fwidth(isf_FragNormCoord.x); gl_FragColor = vec4(round(w)); }')).fragmentShader;
    const ext = glsl.indexOf('#extension');
    expect(ext).toBeGreaterThanOrEqual(0);
    expect(glsl.slice(0, ext).trim()).toBe('');
  });

  const dir = join(process.cwd(), 'public', 'ISF');
  const library = readdirSync(dir).filter((f) => f.endsWith('.fs'));
  const MISSING: Record<string, RegExp> = {
    tanh: /\bfloat\s+tanh\s*\(\s*float/,
    round: /\bfloat\s+round\s*\(/,
    transpose: /\bmat\d\s+transpose\s*\(/,
  };

  it('the shipped library has everything GLSL ES 1.0 needs', () => {
    expect(library.length).toBeGreaterThan(100);
    for (const file of library) {
      let glsl: string;
      try {
        glsl = parseISF(readFileSync(join(dir, file), 'utf8')).fragmentShader;
      } catch {
        continue;
      }
      for (const [fn, definition] of Object.entries(MISSING)) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(glsl)) expect(definition.test(glsl), `${file} uses ${fn}()`).toBe(true);
      }
      // A directive, not one commented out.
      const ext = glsl.search(/^[ \t]*#extension/m);
      if (ext >= 0) expect(glsl.slice(0, ext).trim(), `${file}: #extension must come first`).toBe('');
    }
  });
});
