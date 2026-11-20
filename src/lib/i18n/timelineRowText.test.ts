import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPatterns, translateText, UI_LANGUAGES } from './index';

/**
 * The Timeline's row headers and the Perform list came out half translated
 * ("3 Ebenes on it", "shows its look", "Fires Untitled"): they were put
 * together in code the extractor did not read, so no pack had them. Each is
 * now a whole phrase in source.json and every pack.
 */
const DIR = join(process.cwd(), 'src', 'lib', 'i18n');
const CODES = UI_LANGUAGES.map((l) => l.code).filter((code) => code !== 'en');
const source = new Set<string>(JSON.parse(readFileSync(join(DIR, 'source.json'), 'utf8')));

// What the screen shows (user names stay as typed).
const SHOWN = [
  '3 layers on it',
  '1 layer on it',
  'shows its look',
  '2 blocks',
  'layer on Surface 2',
  '3 pieces · one picture',
  'Follows',
  'Waits for GO',
  'Moves the list along',
  'On GO',
  'Fires Untitled',
  'Goes to Drop 3',
  'Leaves the Build loop at the end of this pass',
  'Plays the show',
  'Nothing waits',
];

describe('Timeline rows and Perform text in every language', () => {
  for (const code of CODES) {
    it(`${code}: translated whole, no English left`, () => {
      const pack = JSON.parse(readFileSync(join(DIR, 'locales', `${code}.json`), 'utf8')) as Record<string, string>;
      const patterns = buildPatterns(pack);
      for (const text of SHOWN) {
        const out = translateText(text, pack, patterns);
        expect(out, text).not.toBeNull();
        expect(out, text).not.toMatch(/\bon it\b|\bits look\b|\bWaits\b|\bFires\b|\bGoes\b|\blist along\b|\bthis pass\b|\bthe show\b|\bpieces\b/);
      }
    });
  }

  it('the phrases are in source.json', () => {
    for (const s of ['{0} layers on it', 'shows its look', 'layer on {0}', 'Waits for GO', 'Fires {0}', 'Moves the list along', 'On GO']) {
      expect(source.has(s), s).toBe(true);
    }
  });
});
