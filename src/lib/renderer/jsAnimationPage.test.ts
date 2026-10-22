import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isP5Page, jsAnimationFromHtml, parseShaderParamDefs, parseShaderParamValues } from './jsAnimationPage';

describe('parseShaderParamDefs', () => {
  it('reads defs whose colour defaults are arrays inside the array', () => {
    const html = `<script>
      window.shaderParamDefs = [
        { name: 'speed', label: 'Speed', type: 'number', min: 0, max: 3, default: 1.0 }, // trailing comment
        { name: "tint", label: "Tint", type: "color", default: [0.4, 0.7, 1.0] },
        /* block comment */ { name: 'mirror', type: 'boolean', default: true },
      ];
    </script>`;
    expect(parseShaderParamDefs(html)).toEqual([
      { name: 'speed', type: 'number', default: 1, min: 0, max: 3, label: 'Speed' },
      { name: 'tint', type: 'color', default: [0.4, 0.7, 1], label: 'Tint' },
      { name: 'mirror', type: 'boolean', default: true, label: 'mirror' },
    ]);
  });

  it('refuses to run code placed in the literal', () => {
    let ran = false;
    (globalThis as any).__pageSideEffect = () => { ran = true; };
    expect(parseShaderParamDefs('window.shaderParamDefs = [__pageSideEffect()];')).toEqual([]);
    expect(parseShaderParamDefs('window.shaderParamDefs = [{ name: `a${1}`, type: "number" }];')).toEqual([]);
    expect(parseShaderParamDefs('window.shaderParamDefs = [{ name: "a", type: "number", max: Math.PI }];')).toEqual([]);
    expect(ran).toBe(false);
  });

  it('skips entries it does not understand rather than failing the rest', () => {
    const html = 'window.shaderParamDefs = [{ name: "a", type: "vector" }, { type: "number" }, { name: "b", type: "number", default: -2.5e-1 }]';
    expect(parseShaderParamDefs(html)).toEqual([
      { name: 'b', type: 'number', default: -0.25, min: undefined, max: undefined, label: 'b' },
    ]);
  });
});

describe('parseShaderParamValues', () => {
  it('reads unquoted keys, trailing commas, hex and negative numbers', () => {
    expect(parseShaderParamValues('window.shaderParams = { speed: 1.5, hue: -0.2, mask: 0xff, on: false, tint: [1, 0.5, 0], };'))
      .toEqual({ speed: 1.5, hue: -0.2, mask: 255, on: false, tint: [1, 0.5, 0] });
  });

  it('returns nothing for a literal that is not plain data', () => {
    expect(parseShaderParamValues('window.shaderParams = { speed: getSpeed() };')).toEqual({});
    expect(parseShaderParamValues('window.shaderParams = makeParams();')).toEqual({});
  });
});

describe('jsAnimationFromHtml', () => {
  it('uses declared defs with the page values over their defaults', () => {
    const embryo = readFileSync(resolve(__dirname, '../../../public/threejs/embryo/index.html'), 'utf8');
    const source = jsAnimationFromHtml(embryo);
    expect(source.animationType).toBe('threejs');
    expect(source.params?.map((p) => p.name)).toContain('electronColor');
    expect(source.paramValues?.electronColor).toEqual([0.4, 0.7, 1.0]);
  });

  it('falls back to the flat shaderParams literal when there are no defs', () => {
    const html = '<script src="https://cdn.example/p5.min.js"></script><script>window.shaderParams = { speed: 1.0, size: 60 };</script>';
    const source = jsAnimationFromHtml(html);
    expect(source.animationType).toBe('p5js');
    expect(source.params?.map((p) => p.name)).toEqual(['speed', 'size']);
    expect(source.paramValues).toEqual({ speed: 1, size: 60 });
  });

  it('leaves params off a page that declares none', () => {
    expect(jsAnimationFromHtml('<canvas></canvas>')).toEqual({ animationType: 'threejs', htmlCode: '<canvas></canvas>' });
    expect(isP5Page('<script>new p5((s) => {});</script>')).toBe(true);
  });
});

describe('text and dropdown controls', () => {
  const html = `<script src="p5.min.js"></script><script>
    window.shaderParams = { words: 'HELLO WORLD', font: 'Serif', speed: 1.0 };
    window.shaderParamDefs = [
      { name: 'words', label: 'Words', type: 'text', default: 'GHOST' },
      { name: 'font', label: 'Font', type: 'select', options: ['Sans', 'Serif'], default: 'Sans' },
      { name: 'bad', label: 'Bad', type: 'select', options: [], default: 'x' },
      { name: 'speed', label: 'Speed', type: 'number', min: 0, max: 3, default: 1 },
    ];
  </script>`;

  it('reads a text box and a dropdown, with their starting values', () => {
    const page = jsAnimationFromHtml(html);
    const byName = Object.fromEntries((page.params ?? []).map((p) => [p.name, p]));
    expect(byName.words).toMatchObject({ type: 'text', default: 'GHOST', label: 'Words' });
    expect(byName.font).toMatchObject({ type: 'select', options: ['Sans', 'Serif'], default: 'Sans' });
    expect(byName.bad).toBeUndefined();
    expect(page.paramValues).toMatchObject({ words: 'HELLO WORLD', font: 'Serif', speed: 1 });
  });

  it('caps text length', () => {
    const long = 'x'.repeat(2000);
    const page = jsAnimationFromHtml(`<script>window.shaderParamDefs = [{ name: 't', type: 'text', default: '${long}' }];</script>`);
    expect(String(page.params?.[0].default).length).toBe(500);
  });
});
