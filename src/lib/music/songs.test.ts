import { describe, expect, it } from 'vitest';
import {
  SONG_SETUP_GROUPS,
  captureSetup,
  defaultRecall,
  emptySongVisuals,
  nextSetlistName,
  nextSongName,
  normalizeSetlists,
  normalizeSong,
  normalizeSongs,
  recalledSetup,
  setlistStep,
  type Song,
} from './songs';
import { defaultProjectState, normalizeSongSetup } from './musicStudioStore';

function song(id: string, patch: Partial<Song> = {}): Song {
  return {
    id,
    name: id,
    bpm: 120,
    sceneId: null,
    notes: '',
    setup: captureSetup(defaultProjectState()),
    visuals: emptySongVisuals(),
    recall: defaultRecall(),
    ...patch,
  };
}

describe('songs', () => {
  it('captures a deep copy of the setup', () => {
    const state = defaultProjectState();
    const setup = captureSetup(state);
    state.params['drone.tone'] = 0.99;
    state.liveInputs[0].role = 'bass';
    expect(setup.params['drone.tone']).not.toBe(0.99);
    expect(setup.liveInputs[0].role).toBe('lead');
    expect(Object.keys(setup).sort()).toEqual(Object.values(SONG_SETUP_GROUPS).flat().sort());
  });

  it('puts back only the parts it recalls', () => {
    const s = song('a', { recall: { sound: false, band: true, visuals: false } });
    const out = recalledSetup(s);
    // The mixer comes with the band for its band input strips (the store takes only those).
    expect(Object.keys(out).sort()).toEqual(['bandFx', 'liveInputs', 'mixer']);
    out.bandFx!.echoSend = 1;
    expect(s.setup.bandFx.echoSend).toBe(0);
  });

  it('reads a saved song back, filling in what is missing', () => {
    const read = normalizeSong(
      { id: 'song-1', name: '  Opener ', bpm: 1000, setup: { set: 'dub', bandFx: { duckDepth: 3 } }, visuals: { vjColumn: 2, voices: [{ file: 'VX-Scope.fs', source: 'bass' }, { file: '../evil.fs' }] }, recall: { band: false } },
      normalizeSongSetup,
    );
    expect(read).not.toBeNull();
    expect(read!.name).toBe('Opener');
    expect(read!.bpm).toBe(300);
    expect(read!.setup.set).toBe('dub');
    expect(read!.setup.bandFx.duckDepth).toBe(1);
    expect(read!.setup.liveInputs).toHaveLength(1);
    expect(read!.visuals.vjColumn).toBe(2);
    expect(read!.visuals.voices?.map((v) => v.file)).toEqual(['VX-Scope.fs']);
    expect(read!.recall).toEqual({ sound: true, band: false, visuals: true });
  });

  it('drops songs without an id and repeats of one', () => {
    const songs = normalizeSongs([{ name: 'x' }, { id: 'a' }, { id: 'a', name: 'again' }, { id: 'b', bpm: null }], normalizeSongSetup);
    expect(songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(songs[1].bpm).toBeNull();
  });

  it('keeps only known songs in set lists, repeats allowed', () => {
    const lists = normalizeSetlists([{ id: 'l1', name: 'Friday', songIds: ['a', 'gone', 'b', 'a'] }, { id: 'l1' }, { name: 'no id' }], new Set(['a', 'b']));
    expect(lists).toEqual([{ id: 'l1', name: 'Friday', songIds: ['a', 'b', 'a'] }]);
  });

  it('steps through a set list and stops at the ends', () => {
    const list = { songIds: ['a', 'b', 'c'] };
    expect(setlistStep(list, -1, 1)).toBe(0);
    expect(setlistStep(list, -1, -1)).toBeNull();
    expect(setlistStep(list, 0, 1)).toBe(1);
    expect(setlistStep(list, 2, 1)).toBeNull();
    expect(setlistStep(list, 2, -1)).toBe(1);
    expect(setlistStep({ songIds: [] }, -1, 1)).toBeNull();
    expect(setlistStep(null, 0, 1)).toBeNull();
  });

  it('names new songs and set lists in sequence', () => {
    expect(nextSongName([])).toBe('Song 1');
    expect(nextSongName([{ name: 'Song 4' }, { name: 'Opener' }])).toBe('Song 5');
    expect(nextSetlistName([{ name: 'Set 1' }])).toBe('Set 2');
  });
});
