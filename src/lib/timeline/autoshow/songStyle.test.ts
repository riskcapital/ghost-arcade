/**
 * The song's style from synthetic songs whose style is known (five styles,
 * then the same songs at other tempos), and the measures behind it.
 */
import { describe, expect, it } from 'vitest';
import { analyzeSongFeatures } from '../lines/songFeatures';
import { createTempoMap } from '../../show/tempoMap';
import { detectSongStructure } from '../score/songStructure';
import { classifyStyle, readSongStyle, type ShowStyle } from './songStyle';
// @ts-expect-error plain JS shared with the Show Runner's fixtures
import { styleSong, STYLE_SONGS } from '../../../../scripts/show-runner/styleSongs.mjs';

function read(style: string, opts: { bpm?: number; scale?: number; pulse?: boolean } = {}) {
  const bpm = opts.bpm ?? STYLE_SONGS[style].bpm;
  const features = analyzeSongFeatures(styleSong(style, 22050, opts), 22050);
  const tempo = createTempoMap(bpm, 0);
  const structure = detectSongStructure(features, tempo, { origin: 0, start: 0, end: features.duration });
  return readSongStyle(features, tempo, structure, 0, opts.pulse ?? true);
}

describe('song style', () => {
  it.each([
    ['chill', 'chill'], ['groove', 'groove'], ['driving', 'driving'], ['hard', 'hard'], ['cinematic', 'cinematic'],
  ] as Array<[string, ShowStyle]>)('a %s song reads as %s', (song, style) => {
    const r = read(song, { scale: 0.5 });
    expect(r.style).toBe(style);
    // The winner is clear, not a coin toss.
    const others = Object.entries(r.scores).filter(([k]) => k !== style).map(([, v]) => v);
    expect(r.scores[style] - Math.max(...others)).toBeGreaterThan(0.2);
  });

  it('the measures say why: soft sparse hits for chill, a kick on every beat for driving, none for cinematic', () => {
    const chill = read('chill', { scale: 0.5 }).measures;
    const driving = read('driving', { scale: 0.5 }).measures;
    const cinematic = read('cinematic', { scale: 0.5 }).measures;
    expect(chill.hitsPerBeat).toBeLessThan(0.8);
    expect(chill.punchDb).toBeLessThan(driving.punchDb);
    expect(driving.lowOnBeat).toBeGreaterThan(0.6);
    expect(driving.hitsPerBeat).toBeGreaterThan(1.2);
    expect(cinematic.hitOnBeat).toBeLessThan(0.15);
  });

  it('tempo moves a song between styles the way the rules say', () => {
    // Four on the floor at 122 still drives; at 152 it is hard.
    expect(read('driving', { bpm: 122, scale: 0.5 }).style).toBe('driving');
    expect(read('driving', { bpm: 152, scale: 0.5 }).style).toBe('hard');
    // A syncopated groove at 96 is a groove; slowed to 74, chill.
    expect(read('groove', { bpm: 96, scale: 0.5 }).style).toBe('groove');
    expect(read('chill', { bpm: 72, scale: 0.5 }).style).toBe('chill');
  });

  it('no steady beat found is cinematic, whatever else', () => {
    const r = read('driving', { scale: 0.5, pulse: false });
    expect(r.style).toBe('cinematic');
    const m = { bpm: 128, hitsPerBeat: 1.7, punchDb: 21, hitOnBeat: 0.8, lowOnBeat: 0.9, sustained: 0.4, rangeDb: 20, lowShare: 0.8, longestRise: 8, pulse: true };
    expect(classifyStyle(m).style).toBe('driving');
    expect(classifyStyle({ ...m, pulse: false }).style).toBe('cinematic');
    expect(classifyStyle(m)).toEqual(classifyStyle(m));
  });
});
