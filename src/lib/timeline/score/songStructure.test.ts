/**
 * Section detection on synthetic songs whose structure is known: every
 * boundary within a bar of the truth (they land on the bar), labels from
 * energy and how it moves, the same song gives the same answer, and the
 * song's place on the Timeline (start, in-point, bar 1) is honoured.
 */
import { describe, expect, it } from 'vitest';
import { analyzeSongFeatures } from '../lines/songFeatures';
import { createTempoMap } from '../../show/tempoMap';
import { detectSongStructure, phraseScore } from './songStructure';
import { synthBoundaries, synthSong, SYNTH_DEFAULT, type SynthSpec } from './synthSong.testutil';

function detect(spec: SynthSpec, placeAt = 0) {
  const features = analyzeSongFeatures(synthSong(spec), 22050);
  const tempo = createTempoMap(spec.bpm, placeAt + (spec.lead ?? 0));
  return { structure: detectSongStructure(features, tempo, { origin: placeAt, start: placeAt, end: placeAt + features.duration }), features, tempo };
}

function boundariesMatch(found: number[], truth: number[], bar: number) {
  expect(found.length).toBe(truth.length);
  found.forEach((t, i) => expect(Math.abs(t - truth[i])).toBeLessThan(bar));
}

describe('section boundaries', () => {
  it('finds intro, build, drop, breakdown, build, drop, outro within a bar', () => {
    const { structure } = detect(SYNTH_DEFAULT);
    const found = [structure.sections[0].start, ...structure.sections.map((s) => s.end)];
    boundariesMatch(found, synthBoundaries(SYNTH_DEFAULT), 2);
    expect(structure.sections.map((s) => s.kind)).toEqual(['intro', 'build', 'drop', 'breakdown', 'build', 'drop', 'outro']);
    expect(structure.sections.map((s) => s.name)).toEqual(['Intro', 'Build 1', 'Drop 1', 'Breakdown', 'Build 2', 'Drop 2', 'Outro']);
    // Phrase lengths in bars.
    expect(structure.sections.map((s) => s.bars)).toEqual([8, 8, 16, 8, 4, 8, 8]);
  });

  it('another tempo, a lead-in, a verse, the song placed 3 s into the Timeline', () => {
    const spec: SynthSpec = { bpm: 128, lead: 0.5, parts: [{ part: 'intro', bars: 8 }, { part: 'verse', bars: 16 }, { part: 'build', bars: 8 }, { part: 'drop', bars: 16 }, { part: 'breakdown', bars: 8 }, { part: 'drop', bars: 16 }, { part: 'outro', bars: 8 }] };
    const { structure } = detect(spec, 3);
    const truth = synthBoundaries(spec).map((t) => t + 3);
    boundariesMatch([structure.sections[0].start, ...structure.sections.map((s) => s.end)], truth, 240 / 128);
    expect(structure.sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'build', 'drop', 'breakdown', 'drop', 'outro']);
  });

  it('a short song at 100 BPM', () => {
    const spec: SynthSpec = { bpm: 100, parts: [{ part: 'intro', bars: 4 }, { part: 'drop', bars: 8 }, { part: 'breakdown', bars: 4 }, { part: 'build', bars: 4 }, { part: 'drop', bars: 8 }] };
    const { structure } = detect(spec);
    boundariesMatch([structure.sections[0].start, ...structure.sections.map((s) => s.end)], synthBoundaries(spec), 2.4);
    expect(structure.sections.map((s) => s.kind)).toEqual(['intro', 'drop', 'breakdown', 'build', 'drop']);
  });

  it('energy: drops are the most intense, the outro the least; the build rises', () => {
    const { structure } = detect(SYNTH_DEFAULT);
    const byKind = (k: string) => structure.sections.filter((s) => s.kind === k);
    for (const d of byKind('drop')) expect(d.energy).toBeGreaterThan(0.9);
    expect(byKind('outro')[0].energy).toBeLessThan(0.2);
    for (const b of byKind('build')) expect(b.rise).toBeGreaterThan(0.08);
    expect(structure.barEnergy).toHaveLength(structure.bars.length - 1);
  });

  it('is deterministic', () => {
    const a = detect(SYNTH_DEFAULT).structure;
    const b = detect(SYNTH_DEFAULT).structure;
    expect(b).toEqual(a);
  });

  it('prefers musical phrase lengths', () => {
    expect(phraseScore(16)).toBeGreaterThan(phraseScore(12));
    expect(phraseScore(8)).toBeGreaterThan(phraseScore(6));
    expect(phraseScore(4)).toBeGreaterThan(phraseScore(5));
  });
});
