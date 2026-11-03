import { describe, expect, it } from 'vitest';
import { LevelHits, guessRole, mappedTracks, normalizeLiveRoles, liveMatchFor } from './liveControl';
import { normalizeProjectState } from './musicStudioStore';

describe('Live control', () => {
  it('guesses a sound from a track name', () => {
    expect(guessRole('Kick')).toBe('kick');
    expect(guessRole('808 Sub')).toBe('bass');
    expect(guessRole('HH open')).toBe('hats');
    expect(guessRole('Rhodes')).toBe('chords');
    expect(guessRole('Lead Guitar')).toBe('lead');
    expect(guessRole('Atmos Pad')).toBe('pad');
    expect(guessRole('Drums')).toBe('kick');
    expect(guessRole('Audio 3')).toBeNull();
  });

  it('maps tracks by name, wherever they are in the set', () => {
    const tracks = [{ name: 'Bass' }, { name: 'Kick' }, { name: 'Other' }, { name: 'Kick' }];
    expect(mappedTracks(tracks, { Kick: 'kick', Bass: 'bass', Gone: 'pad' })).toEqual([
      { index: 0, role: 'bass' },
      { index: 1, role: 'kick' },
      { index: 3, role: 'kick' },
    ]);
  });

  it('keeps only real sounds when loading', () => {
    expect(normalizeLiveRoles({ Kick: 'kick', Bad: 'nope', '': 'bass' })).toEqual({ Kick: 'kick' });
    expect(normalizeLiveRoles(null)).toEqual({});
  });

  it('hears hits in a level stream', () => {
    const h = new LevelHits();
    const out: (string | null)[] = [];
    // Silence, a kick, its decay, silence, another kick.
    const levels = [0, 0, 0.9, 0.7, 0.45, 0.25, 0.1, 0.03, 0, 0, 0.85, 0.6];
    levels.forEach((v, i) => out.push(h.step(v, i * 0.02)?.type ?? null));
    expect(out).toEqual([null, null, 'on', null, null, null, null, 'off', null, null, 'on', null]);
  });

  it('saves and loads the controller settings', () => {
    const state = normalizeProjectState({ liveControl: true, liveRoles: { Kick: 'kick' }, mixer: { drums: { low: 3 } }, liveInput: { role: 'bass', sensitivity: 2 } });
    expect(state.liveControl).toBe(true);
    expect(state.liveRoles).toEqual({ Kick: 'kick' });
    expect(state.mixer.drums?.low).toBe(3);
    expect(state.liveInputs).toEqual([{ name: '', channel: -1, role: 'bass', sensitivity: 1, volume: 0.5, monitor: true, fxSend: 1 }]);
    expect(normalizeProjectState({}).liveControl).toBe(false);
  });
});

describe('matching the studio visuals to Live tracks', () => {
  const show = [
    { name: 'Kick', role: null, drums: false },
    { name: 'Snare & Clap', role: null, drums: false },
    { name: 'Hats', role: null, drums: false },
    { name: 'Bass', role: null, drums: false },
    { name: 'Keys', role: null, drums: false },
    { name: 'Lead', role: null, drums: false },
    { name: 'Pads', role: null, drums: false },
  ];
  it('puts each sound on its own track', () => {
    expect(liveMatchFor('hats', show)).toBe('live:Hats');
    expect(liveMatchFor('kick', show)).toBe('live:Kick');
    expect(liveMatchFor('chords', show)).toBe('live:Keys');
    expect(liveMatchFor('acid', show)).toBe('live:Bass');
    expect(liveMatchFor('pad', show)).toBe('live:Pads');
  });
  it('uses a drum track part when the drums share one track', () => {
    const kit = [{ name: 'Drums', role: null, drums: true }, { name: 'Bass', role: null, drums: false }];
    expect(liveMatchFor('hats', kit)).toBe('live:Drums/hats');
    expect(liveMatchFor('kick', kit)).toBe('live:Drums/kick');
  });
  it('leaves Everything and What you play alone', () => {
    expect(liveMatchFor('all', show)).toBeNull();
    expect(liveMatchFor('played', show)).toBeNull();
  });
});
