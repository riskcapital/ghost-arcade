import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { defaultProjectState, demoSetSongs, musicStudio, normalizeSongSetup } from './musicStudioStore';
import { buildDemoSongs } from './demoSongs';
import { TRACK_IDS } from './session';
import { normalizeSong } from './songs';
import { isPaletteId } from './studioPalettes';
import { patternBeats } from './drumPattern';

const clips = (session: ReturnType<typeof defaultProjectState>['session']) => TRACK_IDS.flatMap((t) => session[t]).filter(Boolean);

describe('a new studio starts empty', () => {
  it('has no songs, set lists or clips', () => {
    const s = defaultProjectState();
    expect(s.songs).toEqual([]);
    expect(s.setlists).toEqual([]);
    expect(s.currentSongId).toBeNull();
    expect(clips(s.session)).toEqual([]);
  });
});

describe('loading and clearing the demo set', () => {
  it('adds the ten songs after any already there, in a set list of their own, and Clear takes everything away', () => {
    musicStudio.clearSongs();
    const first = musicStudio.loadDemoSet();
    expect(first).toHaveLength(10);
    let s = get(musicStudio);
    expect(s.songs).toHaveLength(10);
    expect(s.setlists.map((l) => l.name)).toEqual(['Demo set']);
    expect(s.activeSetlistId).toBe(s.setlists[0].id);
    expect(s.setlists[0].songIds).toEqual(first!.map((x) => x.id));

    // Again: a second copy goes after the first, with its own list.
    musicStudio.loadDemoSet();
    s = get(musicStudio);
    expect(s.songs).toHaveLength(20);
    expect(s.setlists).toHaveLength(2);

    musicStudio.clearSongs();
    s = get(musicStudio);
    expect(s.songs).toEqual([]);
    expect(s.setlists).toEqual([]);
    expect(s.activeSetlistId).toBeNull();
    expect(clips(s.session)).toEqual([]);
  });

  it('brings each song\'s clips, key, tempo and look, and leaves the sound and the band alone', () => {
    for (const song of demoSetSongs(defaultProjectState())) {
      expect(song.recall).toEqual({ sound: false, band: false, visuals: true });
      // No studio voices of their own: the pictures are all on the clips.
      expect(song.visuals.voices).toEqual([]);
      expect(song.visuals.look?.mix.mode).toBe('random');
      expect(song.notes.length).toBeGreaterThan(0);
      // Survives a save and load with its look.
      expect(normalizeSong(JSON.parse(JSON.stringify(song)), normalizeSongSetup)?.visuals.look).toEqual(song.visuals.look);
    }
  });
});

describe('the demo songs', () => {
  let n = 0;
  const songs = buildDemoSongs(() => `id${n++}`);

  it('each has a palette of its own', () => {
    const palettes = songs.map((s) => s.look.palette);
    for (const p of palettes) expect(isPaletteId(p), p).toBe(true);
    expect(new Set(palettes).size).toBe(songs.length);
  });

  it('plays a pad on the texture track in the intro, bridge, chorus, break and outro', () => {
    for (const song of songs) {
      for (const name of ['Intro', 'Bridge', 'Chorus', 'Break', 'Outro']) {
        const row = song.sections.find((s) => s.name === name)!.row;
        const pad = song.session.texture[row];
        expect(pad?.kind === 'notes' && pad.tone?.startsWith('pad.'), `${song.name} ${name}`).toBe(true);
      }
    }
  });

  it('ends an eight-bar phrase in a fill: the snare plays through the last beat', () => {
    let phrases = 0;
    for (const song of songs) {
      for (const clip of song.session.beats) {
        if (clip?.kind !== 'beat' || patternBeats(clip.pattern) !== 32 || clip.name.startsWith('Bridge')) continue;
        phrases++;
        const steps = clip.pattern.steps;
        const lastBeat = clip.pattern.tracks.snare.slice(steps - steps / 32);
        expect(lastBeat.filter((v) => v > 0).length, `${song.name} ${clip.name}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(phrases).toBeGreaterThan(10);
  });

  it('draws every look on something solid: the bottom layer of a clip\'s visuals is never see-through', () => {
    for (const song of songs) {
      for (const track of TRACK_IDS) {
        for (const clip of song.session[track]) {
          const items = clip?.stack?.items;
          if (!items?.length) continue;
          // A stack lists its top layer first.
          expect(items[items.length - 1].voice?.clear, `${song.name} ${clip!.name}`).not.toBe(true);
        }
      }
    }
  });
});
