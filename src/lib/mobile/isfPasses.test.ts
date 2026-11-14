import { describe, expect, it } from 'vitest';
import { declarePasses, passSize, passSpecs, passTargets, rewriteBufferMacros } from './isfPasses';

describe('pass declarations', () => {
  it('reads targets, persistence, float and sizes, and nothing for a single-pass shader', () => {
    expect(passSpecs({})).toEqual([]);
    expect(passSpecs({ PASSES: [] })).toEqual([]);
    const specs = passSpecs({ PASSES: [{ TARGET: 'state', PERSISTENT: true, FLOAT: true, WIDTH: 1, HEIGHT: '1' }, { TARGET: 'pic', WIDTH: '$WIDTH/2' }, {}] });
    expect(specs).toEqual([
      { target: 'state', persistent: true, float: true, width: '1', height: '1' },
      { target: 'pic', persistent: false, float: false, width: '$WIDTH/2', height: undefined },
      { target: undefined, persistent: false, float: false, width: undefined, height: undefined },
    ]);
    // A target name that is not a GLSL identifier is not a buffer.
    expect(passSpecs({ PASSES: [{ TARGET: 'bad name' }] })[0].target).toBeUndefined();
  });
  it('lists each buffer once, merging what any pass says of it', () => {
    const targets = passTargets(passSpecs({ PASSES: [{ TARGET: 'a', WIDTH: '8' }, { TARGET: 'a', PERSISTENT: true }, { TARGET: 'b' }, {}] }));
    expect(targets.map((t) => [t.target, t.persistent, t.width])).toEqual([['a', true, '8'], ['b', false, undefined]]);
  });
});

describe('buffer sizes', () => {
  it('evaluates numbers and expressions of the picture size, at least one pixel', () => {
    expect(passSize('$WIDTH/2', 1280, 720, 1280)).toBe(640);
    expect(passSize('$HEIGHT/4', 1280, 720, 720)).toBe(180);
    expect(passSize('128', 1280, 720, 1280)).toBe(128);
    expect(passSize('($WIDTH + $HEIGHT) * 0.5', 100, 50, 100)).toBe(75);
    expect(passSize('$WIDTH/16', 8, 8, 8)).toBe(1);
    expect(passSize('$WIDTH/3', 1279, 720, 1279)).toBe(426);
  });
  it('falls back to the picture size for a missing or unreadable expression, never running code', () => {
    expect(passSize(undefined, 1280, 720, 720)).toBe(720);
    expect(passSize('', 1280, 720, 1280)).toBe(1280);
    expect(passSize('alert(1)', 1280, 720, 1280)).toBe(1280);
    expect(passSize('$WIDTH/0', 1280, 720, 99)).toBe(99);
    expect(passSize('2 2', 1280, 720, 7)).toBe(7);
  });
});

describe('buffer macros and declarations', () => {
  it('writes out the size and this-pixel macros for buffers, with nested brackets', () => {
    const src = 'vec2 s = IMG_SIZE(bins); vec4 a = IMG_THIS_PIXEL(state); vec4 b = IMG_PIXEL(state, floor(p * vec2(2.0, 1.0)) + 0.5); vec4 c = IMG_NORM_PIXEL(state, uv); vec4 d = IMG_SIZE(other);';
    const out = rewriteBufferMacros(src, ['bins', 'state']);
    expect(out).toContain('vec2 s = _bins_imgSize;');
    expect(out).toContain('vec4 a = texture2D(state, isf_FragNormCoord);');
    expect(out).toContain('vec4 b = texture2D(state, (floor(p * vec2(2.0, 1.0)) + 0.5) / _state_imgSize);');
    // Normalised reads already work; an unknown image is left alone.
    expect(out).toContain('IMG_NORM_PIXEL(state, uv)');
    expect(out).toContain('IMG_SIZE(other)');
  });
  it('leaves a function definition with the same name alone', () => {
    const src = 'vec4 IMG_PIXEL(sampler2D img, vec2 coord) { return texture2D(img, coord); }';
    expect(rewriteBufferMacros(src, ['img'])).toBe(src);
  });
  it('declares PASSINDEX and each buffer after the precision line, once', () => {
    const glsl = 'precision highp float;\nuniform vec2 RENDERSIZE;\nvoid main() {}';
    const out = declarePasses(glsl, ['state']);
    expect(out.indexOf('uniform int PASSINDEX;')).toBeGreaterThan(out.indexOf('precision highp float;'));
    expect(out.indexOf('uniform sampler2D state;')).toBeLessThan(out.indexOf('void main'));
    expect(out).toContain('uniform vec2 _state_imgSize;');
    expect(declarePasses(out, ['state'])).toBe(out);
  });
});
