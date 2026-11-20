import { describe, expect, it } from 'vitest';
import { buildDemoSongs } from './demoSongs';
import { patternBeats } from './drumPattern';
import { TRACK_IDS, normalizeSession } from './session';
import { normalizeSections, sectionAtBar, sectionsBars } from './songs';
import { SCALES } from './studioSets';

let n = 0;
const songs = buildDemoSongs(() => `id${n++}`);

describe('starter songs', () => {
  it('is a set of eight songs, each with eight rows and an arrangement over them', () => {
    expect(songs).toHaveLength(8);
    for (const song of songs) {
      for (const track of TRACK_IDS) expect(song.session[track]).toHaveLength(8);
      expect(song.sections.length).toBeGreaterThanOrEqual(8);
      // Every row is played, and every section has something on its row.
      expect(new Set(song.sections.map((s) => s.row)).size).toBe(8);
      for (const section of song.sections) {
        expect(TRACK_IDS.some((t) => song.session[t][section.row])).toBe(true);
        expect(section.bars % 4).toBe(0);
      }
    }
  });

  it('keeps every part of a song in its key', () => {
    for (const song of songs) {
      const scale = new Set(SCALES[song.key.scale].steps.map((s) => (s + song.key.root) % 12));
      for (const track of ['bass', 'lead', 'chords'] as const) {
        for (const clip of song.session[track]) {
          if (clip?.kind !== 'notes') continue;
          expect(clip.key).toEqual(song.key);
          for (const note of clip.notes) expect(scale.has(note.note % 12), `${song.name} ${clip.name}`).toBe(true);
        }
      }
    }
  });

  it('keeps the hook at or under C5 and the bass under the chords', () => {
    for (const song of songs) {
      for (const clip of song.session.lead) if (clip?.kind === 'notes') expect(Math.max(...clip.notes.map((x) => x.note))).toBeLessThanOrEqual(72);
      for (const clip of song.session.bass) if (clip?.kind === 'notes') expect(Math.max(...clip.notes.map((x) => x.note))).toBeLessThan(60);
    }
  });

  it('builds the song up: no drums in the break, the hook only from the bridge on, drums whose length divides the bar count', () => {
    for (const song of songs) {
      const row = (name: string) => song.sections.find((s) => s.name === name)!.row;
      expect(song.session.beats[row('Break')]).toBeNull();
      expect(song.session.lead[row('Intro')]).toBeNull();
      expect(song.session.lead[row('Verse')]).toBeNull();
      expect(song.session.lead[row('Chorus')]).not.toBeNull();
      expect(song.session.bass[row('Intro')]).toBeNull();
      for (const section of song.sections) {
        const beat = song.session.beats[section.row];
        if (beat?.kind === 'beat') expect((section.bars * 4) % patternBeats(beat.pattern)).toBe(0);
      }
    }
  });

  it('survives a save and load', () => {
    for (const song of songs) {
      expect(normalizeSession(JSON.parse(JSON.stringify(song.session)))).toEqual(song.session);
      expect(normalizeSections(JSON.parse(JSON.stringify(song.sections)))).toEqual(song.sections);
    }
  });
});

describe('arrangement', () => {
  const sections = [{ name: 'A', row: 0, bars: 8 }, { name: 'B', row: 1, bars: 16 }];
  it('finds the section a bar falls in', () => {
    expect(sectionsBars(sections)).toBe(24);
    expect(sectionAtBar(sections, 0)).toEqual({ index: 0, start: 0 });
    expect(sectionAtBar(sections, 8)).toEqual({ index: 1, start: 8 });
    expect(sectionAtBar(sections, 24)).toBeNull();
  });
});
