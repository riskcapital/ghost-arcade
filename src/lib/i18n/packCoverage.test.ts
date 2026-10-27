import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPatterns, translateText, UI_LANGUAGES } from './index';

/**
 * Every language pack covers the interface text added in the round of user
 * feedback fixes (New Show from Audio, the show soundtrack bar, the audio
 * output picker, end-of-show options, video decoding badges and the Playback
 * preset, the render core error screen, the log folder, the Snap switches,
 * the quit prompt).
 *
 * Scoped to that round's strings: the older text the packs do not cover yet
 * must not fail this. A string that later leaves source.json (its interface
 * text changed) is skipped rather than failing.
 */

const DIR = join(process.cwd(), 'src', 'lib', 'i18n');
const source = new Set<string>(JSON.parse(readFileSync(join(DIR, 'source.json'), 'utf8')));
const CODES = UI_LANGUAGES.map((l) => l.code).filter((code) => code !== 'en');
const packs = Object.fromEntries(CODES.map((code) => [
  code,
  JSON.parse(readFileSync(join(DIR, 'locales', `${code}.json`), 'utf8')) as Record<string, string>,
]));

// The strings in source.json that are new in the round.
const ROUND = [
  ', or with',
  '· curved, meshed',
  '{0} px{1}',
  '{0} sections{1}, cuts on the beat.',
  'A new preset where the song changes section, on the beat.',
  'A tenth of a pixel',
  'Alt',
  'At the end of the show',
  'build a show from a song…',
  'Change on the music',
  'Checking which formats this computer decodes in hardware…',
  'Choose at least one preset.',
  'Convert for smooth playback',
  'Could not check video decoding: {0}',
  'Create show',
  'Current look',
  'Dragged points snap to other layers and to the canvas edges. Hold {0} while dragging to move freely. Same as Snap in the status bar.',
  'Drop a song here, or',
  'Each chosen preset gets an equal part of the song.',
  'Hardware formats play smoothly, including in reverse. Software formats use the CPU and may lag with several layers. Convert them with File › Video Converter ›',
  'Hold while dragging for fine movement',
  'Hold while dragging to move without snapping',
  'Keep the current look',
  'Let go of the selected point',
  'Listening for sections and beats…',
  'Longest edge',
  'Looks over the song',
  'Make a show to a song',
  'Makes an H.{0} copy beside the file and switches this media to it.',
  'Move the selected point (or the layers) one pixel',
  'New show from audio',
  'New Show from Audio...',
  'on the SW badge of a clip.',
  'Open log',
  'Open log folder',
  'Pause the show',
  'Pick a song and lay your looks over it',
  'Play the show',
  'Presets to use',
  'Press Retry. If it keeps happening, open the log and send it to us.',
  'Quit Without Saving',
  'Reactive timing will follow real elapsed time, so the audio in the exported clip won\'t line up with the visuals if the render runs slower than real time. For frame-accurate reactivity, put the song on the Show timeline (File › New Show from Audio).',
  'Reading the song…',
  'Reinstall Ghost Arcade, then open it again.',
  'Save & Quit',
  'Save presets in the Presets tray to lay them over a song.',
  'Show audio output',
  'Show position',
  'Show soundtrack',
  'Show soundtrack: click or drag to move through the show',
  'Shows {0}. The last three launches are kept.',
  'Snap points to other layers and the canvas edges. Hold {0} while dragging to move freely.',
  'Snap to grid',
  'Snap to layers and canvas edges',
  'Sound card the show audio plays on',
  'Spread presets evenly',
  'Ten pixels at a time',
  'The chosen sound card is not connected: playing on the system default',
  'The first launch after an update can take a while as the graphics driver prepares shaders. Press Retry. If it keeps happening, update your graphics driver.',
  'The picture stays as it is while the song plays.',
  'The render core did not answer in time.',
  'The render core is missing from this installation.',
  'The show\'s audio is added to the video.',
  'This replaces the current show.',
  'Update your graphics driver, then press Retry.',
  'Video decoding is checked in the desktop app.',
  'Video playback',
  'Videos in use that may lag',
  'What happens when the show reaches its end',
  'Your project has unsaved changes that will be lost if you quit without saving.',
];

const placeholders = (text: string) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();

describe('language packs cover the feedback round', () => {
  it('lists the six languages', () => {
    expect(CODES).toEqual(['es', 'de', 'fr', 'pt-BR', 'it', 'ja']);
  });

  for (const code of CODES) {
    it(`${code} translates every new string, keeping its placeholders`, () => {
      const pack = packs[code];
      const current = ROUND.filter((text) => source.has(text));
      expect(current.filter((text) => pack[text] === undefined)).toEqual([]);
      const broken = current.filter((text) => placeholders(pack[text]).join() !== placeholders(text).join());
      expect(broken).toEqual([]);
    });
  }
});

describe('the round text the page shows translates as a whole', () => {
  // Text built in .ts files reaches the page with numbers and file names
  // filled in. These go through the same lookup the page uses.
  const SAMPLES = [
    'Converting for smooth playback (42%)',
    'Software decode — may lag: VP9 has no hardware decoder in this app. Reverse and bounce will not play.',
    "Software decode — may lag: it is 10-bit H.264, which this computer's hardware decoder does not take. Reverse and bounce will not play.",
    '5 sections, about 128 BPM, cuts on the beat.',
    'The render core stopped. Starting it again (attempt 2 of 3)…',
    'The render core stopped (code 0xC0000135).',
    '“song 3.aiff” can\'t be played. Use WAV, MP3, M4A, FLAC or OGG.',
    // An older pattern, "{0} layer{1}", matches any text with " layer" in
    // it; these must be found before it.
    'track 1.mp3: Audio files are not layers. Add songs in the Show timeline.',
    "a.pdf: this file type can't be a layer. Use a video, an image or an .fs shader.",
    'Converted clip.mov. 1 layer and 2 clips now play clip-playback.mp4. Save the project to keep this.',
  ];

  for (const code of CODES) {
    it(`${code}`, () => {
      const pack = packs[code];
      const patterns = buildPatterns(pack);
      for (const text of SAMPLES) {
        const out = translateText(text, pack, patterns);
        expect(out, text).not.toBeNull();
        // Whatever was filled in comes back; the English around it does not.
        for (const kept of text.match(/\d+(?:[.,:]\d+)*|0xC0000135|VP9|song 3\.aiff|track 1\.mp3|a\.pdf|clip(?:-playback)?\.m(?:ov|p4)/g) ?? []) {
          expect(out, text).toContain(kept);
        }
        for (const english of ['hardware decoder', 'Reverse and bounce', 'cuts on the beat', 'Starting it again', "can't be played", 'Audio files', 'this file type', 'Save the project']) {
          if (text.includes(english)) expect(out, text).not.toContain(english);
        }
      }
    });
  }

  it('fills numbers and keeps punctuation in the Japanese and French packs', () => {
    expect(translateText('1920 px (recommended)', packs.ja, buildPatterns(packs.ja))).toBe('1920 px（推奨）');
    expect(translateText('Converting for smooth playback (7%)', packs.fr, buildPatterns(packs.fr))).toBe('Conversion pour une lecture fluide (7 %)');
  });
});

/**
 * Every language pack has an entry for every interface string in
 * source.json: a translation, or the English text itself where a string
 * stays English in that language (brand names, units, words spelled the same).
 * After changing interface text, run `node scripts/i18n-extract.mjs` and add
 * the new strings to all six packs.
 */
describe('language packs cover all interface text', () => {
  for (const code of CODES) {
    it(`${code} has an entry for every string`, () => {
      const missing = [...source].filter((s) => !(s in packs[code]));
      expect(missing, `${missing.length} interface strings have no ${code} entry`).toEqual([]);
    });
  }

  it('keeps every placeholder in every entry', () => {
    const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');
    for (const code of CODES) {
      const broken = Object.entries(packs[code]).filter(([en, out]) => source.has(en) && placeholders(en) !== placeholders(out));
      expect(broken, code).toEqual([]);
    }
  });
});
