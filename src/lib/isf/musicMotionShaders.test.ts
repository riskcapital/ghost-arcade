import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseISF } from './parser';
import { MUSIC_MOTION_INPUTS, shaderIsMusicMotionReady } from '../audio/musicMotion';
import { MUSIC_MOTION_SHADER_FILES, isMusicMotionShaderFile } from './musicMotionShaders';

const dir = join(process.cwd(), 'public', 'ISF');
const files = readdirSync(dir).filter((f) => f.endsWith('.fs'));

describe('shaders made for Music motion', () => {
  it('the list matches the shaders on disk', () => {
    const ready = files.filter((f) => shaderIsMusicMotionReady(readFileSync(join(dir, f), 'utf8'))).sort();
    expect([...MUSIC_MOTION_SHADER_FILES].sort()).toEqual(ready);
  });

  it('looks files up by base name or path', () => {
    expect(isMusicMotionShaderFile('Featured-prism.fs')).toBe(true);
    expect(isMusicMotionShaderFile('sub/Featured-prism.fs')).toBe(true);
    expect(isMusicMotionShaderFile('DM-SolidColor.fs')).toBe(false);
    expect(isMusicMotionShaderFile(undefined)).toBe(false);
  });

  for (const file of MUSIC_MOTION_SHADER_FILES) {
    it(`${file} declares the inputs so that off is the original look`, () => {
      const code = readFileSync(join(dir, file), 'utf8');
      const parsed = parseISF(code);
      const byName = new Map(parsed.metadata.INPUTS.map((i) => [i.NAME, i]));
      for (const name of MUSIC_MOTION_INPUTS) {
        const input = byName.get(name);
        expect(input, `${file} declares ${name}`).toBeTruthy();
        expect(input!.TYPE).toBe('float');
        expect(input!.DEFAULT).toBe(name === 'mmFlow' ? -1 : 0);
      }
      const body = code.slice(code.indexOf('*/') + 2);
      // The ease pass keeps the music's state between frames and runs the clock.
      const ease = (parsed.metadata.PASSES ?? []).find((pass) => pass.TARGET === 'mmEase');
      expect(ease, `${file} has the mmEase pass`).toMatchObject({ PERSISTENT: true, FLOAT: true, WIDTH: 2, HEIGHT: 1 });
      expect(body).toMatch(/if \(PASSINDEX == 0\) \{ mmEaseStep\(\); return; \}/);
      // Off, the clock runs at normal speed.
      expect(body).toMatch(/on \? MM_REST \+ MM_BY_SWELL \* e\.y \+ MM_BY_HIT \* e\.x : 1\.0/);
      // Motion runs on the music clock: raw TIME only in the ease pass and the film grain.
      const outsideEase = body.replace(/void mmEaseStep\(\) \{[\s\S]*?\r?\n\}\r?\n/, '');
      const lines = outsideEase.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ''));
      const stray = lines.filter((l) => /\bTIME\b/.test(l) && !/fract\(TIME\)/.test(l));
      expect(stray, `${file} still runs on raw TIME`).toEqual([]);
      // The body reads the eased values, not the raw inputs.
      const raw = lines.filter((l) => /\bmm(Pulse|Swell|Morph)\b/.test(l));
      expect(raw, `${file} reads raw music inputs`).toEqual([]);
      expect(parsed.fragmentShader).toContain('uniform float mmFlow');
    });
  }
});
