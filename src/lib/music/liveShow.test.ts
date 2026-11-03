import { describe, expect, it } from 'vitest';
import { hasSongs, lanePlan, laneTracks, missingLanes, songOfScene, songPlan } from './liveShow';
import { songsFromScenes } from '../ableton/abletonSetlist';
import type { LiveScene, LiveTrack } from '../ableton/abletonLinks';

const track = (name: string, slots = 0): LiveTrack => ({ name, color: 0, midi: true, side: null, playing: -1, fired: -1, startedBeat: 0, firedBeat: 0, slots: Array.from({ length: slots }, () => ({ name: 'clip', color: 0, length: 4 })) });

describe('a Live set laid out for the Music Studio', () => {
  it('finds the lanes a set already has by name, one track per lane', () => {
    const found = laneTracks([track('909 Drums'), track('Sub Bass'), track('Rhodes'), track('Deck B')]);
    expect(found).toMatchObject({ drums: 0, bass: 1, chords: 2, lead: -1, pads: -1, vocals: -1 });
  });

  it('adds only the lanes that are missing, as named, coloured tracks', () => {
    const missing = missingLanes([track('Drums'), track('Bass')]);
    expect(missing.map((l) => l.id)).toEqual(['chords', 'lead', 'pads', 'vocals']);
    const plan = lanePlan(missing);
    expect(plan.tracks?.[0]).toEqual({ name: 'Chords', midi: true, color: 0xa87cff });
    expect(plan.tracks?.find((t) => t.name === 'Vocals')?.midi).toBe(false);
    expect(plan.rename).toBeUndefined();
  });

  it('writes a new song as a block the setlist reads back as one song', () => {
    const plan = songPlan('Night Drive', 124, ['Intro', 'Verse', 'Drop']);
    expect(plan.scenes?.map((s) => s.name)).toEqual(['Night Drive Intro 124 BPM', 'Night Drive Verse', 'Night Drive Drop']);
    const scenes: LiveScene[] = [
      ...plan.scenes!.map((s) => ({ name: s.name, color: 0, queued: false })),
      ...songPlan('Second', 128, ['Intro', 'Peak'], 1).scenes!.map((s) => ({ name: s.name, color: 0, queued: false })),
    ];
    const songs = songsFromScenes(scenes, [track('Drums', scenes.length)]);
    expect(songs.map((s) => s.title)).toEqual(['Night Drive', 'Second']);
    expect(songs[0].kind === 'scenes' && songs[0].sections.map((s) => s.label)).toEqual(['Intro', 'Verse', 'Drop']);
    expect(songs[0].bpm).toBe(124);
    expect(songOfScene(songs as any, 4)).toBe(1);
    expect(hasSongs(scenes)).toBe(true);
    expect(hasSongs([{ name: 'Scene 1' }])).toBe(false);
  });

  it('keeps a typed tempo out of the title and the tempo in range', () => {
    expect(songPlan('Fast 140 BPM', 999, []).scenes?.[0].name).toBe('Fast Intro 300 BPM');
  });
});
