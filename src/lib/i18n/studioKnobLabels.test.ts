import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_LANGUAGES } from './index';
import { DRONE_PARAMS, ACID_PARAMS } from '../music/studioSets';

/** Audio Lab's knob labels (the Drone's Detune stayed English everywhere). */
const DIR = join(process.cwd(), 'src', 'lib', 'i18n');
const source = new Set<string>(JSON.parse(readFileSync(join(DIR, 'source.json'), 'utf8')));

describe('Audio Lab knob labels in every language', () => {
  const labels = [...DRONE_PARAMS, ...ACID_PARAMS].map((p) => p.label);
  it('are in source.json', () => {
    for (const l of labels) expect(source.has(l), l).toBe(true);
  });
  for (const { code } of UI_LANGUAGES.filter((l) => l.code !== 'en')) {
    it(code, () => {
      const pack = JSON.parse(readFileSync(join(DIR, 'locales', `${code}.json`), 'utf8')) as Record<string, string>;
      for (const l of labels) expect(pack[l], l).toBeTruthy();
    });
  }
});
