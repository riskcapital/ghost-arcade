import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blue, blueRgb, parseBlueToken, type BlueStep } from './blueScale';

const css = readFileSync(fileURLToPath(new URL('../mobile/studio/blueScale.css', import.meta.url)), 'utf8');
const hex = (rgb: number[]) => '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');

describe('blue scale for canvas drawing', () => {
  it('gives the same plain values as blueScale.css for the Arcade blue', () => {
    const plain = [...css.matchAll(/--ga-blue-((?:mute-)?\d{3}):\s*(#[0-9a-f]{6});/g)];
    expect(plain.length).toBe(12);
    for (const [, name, value] of plain) {
      const step = (/^\d+$/.test(name) ? Number(name) : name) as BlueStep;
      // A half-way mix may round either way, so allow one level per channel.
      const got = blueRgb(step, [0x52, 0x78, 0xff]);
      const want = parseBlueToken(value)!;
      expect(Math.max(...got.map((c, i) => Math.abs(c - want[i]))), `${name} ${hex(got)} vs ${value}`).toBeLessThanOrEqual(1);
    }
  });

  it('uses the same mix percentages as the color-mix() rules', () => {
    const mixes = [...css.matchAll(/--ga-blue-((?:mute-)?\d{3}): color-mix\(in srgb, var\(--ga-blue, #5278ff\) (\d+)%, (white|black|#[0-9a-f]{6})\)/g)];
    expect(mixes.length).toBe(11);
    for (const [, name, percent, other] of mixes) {
      const step = (/^\d+$/.test(name) ? Number(name) : name) as BlueStep;
      const o = other === 'white' ? [255, 255, 255] : other === 'black' ? [0, 0, 0] : parseBlueToken(other)!;
      const base = [0x81, 0x9c, 0xff];
      const want = base.map((c, i) => Math.round((c * Number(percent) + o[i] * (100 - Number(percent))) / 100));
      expect(blueRgb(step, base as [number, number, number]), name).toEqual(want);
    }
  });

  it('follows another theme through the token and formats alpha', () => {
    expect(parseBlueToken('#819cff')).toEqual([129, 156, 255]);
    expect(parseBlueToken('#abc')).toEqual([170, 187, 204]);
    expect(parseBlueToken('rgb(108, 182, 201)')).toEqual([108, 182, 201]);
    expect(parseBlueToken('teal')).toBeNull();
    expect(blue(400)).toBe('#5278ff');
    expect(blue(300, 0.5)).toBe('rgba(125, 154, 255, 0.5)');
  });
});
