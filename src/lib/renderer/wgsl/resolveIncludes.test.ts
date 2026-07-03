import { describe, expect, it } from 'vitest';
import { resolveWgslIncludes } from './resolveIncludes';

describe('resolveWgslIncludes', () => {
  it('expands angle and quoted includes recursively', () => {
    const modules = {
      color: 'fn ghost_color() -> f32 { return 1.0; }',
      lighting: '#include "color"\nfn ghost_light() -> f32 { return ghost_color(); }',
    };

    const out = resolveWgslIncludes('#include <lighting>\nfn main() {}', { modules, sourceName: 'test' });

    expect(out).toContain('BEGIN #include <lighting>');
    expect(out).toContain('BEGIN #include <color>');
    expect(out).toContain('fn ghost_color()');
    expect(out).toContain('fn ghost_light()');
  });

  it('accepts .wgsl suffixes and leading ./ prefixes', () => {
    const out = resolveWgslIncludes('#include "./noise.wgsl"', {
      modules: { noise: 'fn ghost_noise() -> f32 { return 0.0; }' },
    });

    expect(out).toContain('ghost_noise');
  });

  it('throws on unknown includes', () => {
    expect(() => resolveWgslIncludes('#include <missing>', { modules: {} }))
      .toThrow(/Unknown WGSL include "missing"/);
  });

  it('throws on circular includes', () => {
    const modules = {
      a: '#include <b>',
      b: '#include <a>',
    };

    expect(() => resolveWgslIncludes('#include <a>', { modules, sourceName: 'root' }))
      .toThrow(/Circular WGSL include/);
  });

  it('emits a shared include once when multiple modules request it', () => {
    const modules = {
      color: 'fn ghost_color() -> f32 { return 1.0; }',
      a: '#include <color>\nfn a() -> f32 { return ghost_color(); }',
      b: '#include <color>\nfn b() -> f32 { return ghost_color(); }',
    };

    const out = resolveWgslIncludes('#include <a>\n#include <b>', { modules, sourceName: 'root' });

    expect(out.match(/BEGIN #include <color>/g)).toHaveLength(1);
    expect(out).toContain('SKIP duplicate #include <color>');
  });
});
