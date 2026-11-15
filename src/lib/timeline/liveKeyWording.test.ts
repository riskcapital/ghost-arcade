// The Timeline's "what I change goes onto the Timeline" switch is called
// Live key, so it is never confused with recording the output (the top
// bar's record button, Record & Share, Render to video). Internal ids keep
// their old names (liveEdit, lineRecord, data-live-edit).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** The visible text of a Svelte file: quoted strings and text between tags, ids and code names left out. */
function visibleWords(source: string): string {
  const noCode = source
    .replace(/<style[^]*?<\/style>/g, '')
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[^]*?-->/g, '');
  const quoted = [...noCode.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]);
  const between = [...noCode.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...quoted, ...between].filter((s) => /\s|^[A-Z]/.test(s)).join('\n');
}

describe('Live key wording', () => {
  for (const file of [
    'src/lib/components/show/timeline/LineRecordControls.svelte',
    'src/lib/components/LiveEditBar.svelte',
  ]) {
    it(`${path.basename(file)} never calls the feature Record or Live edit`, () => {
      const words = visibleWords(read(file));
      expect(words).toMatch(/Live key/);
      expect(words).not.toMatch(/\bRecord(ing|ed)?\b|\brecord(ing|ed|s)?\b|Live edit/);
    });
  }

  it('the take cap notice says Live key', () => {
    expect(read('src/lib/timeline/lines/timelineLines.ts')).toContain("TAKE_CAP_NOTICE = 'Live key stopped: a take can be 30 minutes at most'");
  });

  it('the Timeline tour step is Live key', () => {
    const tour = read('src/lib/components/GuidedTour.svelte');
    const timeline = tour.slice(tour.indexOf("id: 'timeline'"));
    expect(timeline).toContain("title: 'Live key'");
    expect(timeline).not.toMatch(/title: 'Record'|next to Record|With Record on/);
  });

  it('every language pack has the Live key words, and ja no longer says 録画 for them', () => {
    const keys = ['Live key', 'Live key options', 'Stop live key', 'Keying your changes live as it plays', 'Live key stopped: a take can be {0} minutes at most'];
    for (const code of ['es', 'de', 'fr', 'pt-BR', 'it', 'ja']) {
      const pack = JSON.parse(read(`src/lib/i18n/locales/${code}.json`)) as Record<string, string>;
      for (const k of keys) expect(pack[k], `${code}: ${k}`).toBeTruthy();
      if (code === 'ja') for (const k of keys) expect(pack[k]).not.toContain('録画');
    }
  });
});
