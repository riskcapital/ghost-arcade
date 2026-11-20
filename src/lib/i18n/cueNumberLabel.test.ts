import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_LANGUAGES } from './index';

/** The cue editor's "No." is a number, not the word "no" (it read "Nein." / "いいえ。"). */
const DIR = join(process.cwd(), 'src', 'lib', 'i18n', 'locales');
const WORD_NO = /^(nein|non|não|no|いいえ)\W*$/i;

describe('"No." (a cue\'s number) in every language', () => {
  for (const { code } of UI_LANGUAGES.filter((l) => l.code !== 'en')) {
    it(code, () => {
      const pack = JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8')) as Record<string, string>;
      expect(pack['No.']).toBeTruthy();
      expect(pack['No.']).not.toMatch(WORD_NO);
    });
  }
});
