import { describe, expect, it } from 'vitest';
import { gmDrum, isLiveSource, liveSource, parseLiveSource, VoiceSignals, type AnySourceId } from './visualVoices';
import { isDrumTrack } from './liveControl';
import { normalizeStudioVoice } from './studioPlugin';
import type { NoteEvent } from './noteEvents';

const clock = { beat: 0, beatSeconds: 0.5 };
const on = (note: number, time: number, velocity = 0.9): NoteEvent => ({ type: 'on', instrument: 'drums', note, velocity, source: 'midi', time });

describe('Live sources: visuals that follow an Ableton track', () => {
  it('name a track, or one drum of it, and read back', () => {
    expect(liveSource('Drum Rack')).toBe('live:Drum Rack');
    expect(liveSource('Drum Rack', 'snare')).toBe('live:Drum Rack/snare');
    expect(parseLiveSource('live:Drum Rack/snare')).toEqual({ track: 'Drum Rack', drum: 'snare' });
    // A slash in the track's own name is part of the name, not a drum.
    expect(parseLiveSource('live:Bass/Sub')).toEqual({ track: 'Bass/Sub' });
    expect(isLiveSource('live:Keys')).toBe(true);
    expect(isLiveSource('bass')).toBe(false);
    expect(isLiveSource('live:')).toBe(false);
  });

  it('split a drum kit by General MIDI note', () => {
    expect(gmDrum(36)).toBe('kick');
    expect(gmDrum(38)).toBe('snare');
    expect(gmDrum(39)).toBe('snare');
    expect(gmDrum(42)).toBe('hats');
    expect(gmDrum(46)).toBe('hats');
    expect(gmDrum(45)).toBe('perc');
    expect(gmDrum(49)).toBe('perc');
    expect(gmDrum(60)).toBeNull();
  });

  it('only split MIDI tracks that play a kit', () => {
    expect(isDrumTrack({ name: 'Drums', midi: true })).toBe(true);
    expect(isDrumTrack({ name: '909 Rack', midi: true })).toBe(true);
    expect(isDrumTrack({ name: 'Bass', midi: true })).toBe(false);
    expect(isDrumTrack({ name: 'Bass', midi: true }, 'kick')).toBe(true);
    // Audio has no notes to split.
    expect(isDrumTrack({ name: 'Drums', midi: false })).toBe(false);
  });

  it('light only the visuals on that track, and that drum', () => {
    const v = new VoiceSignals();
    const kick: AnySourceId = liveSource('Drums', 'kick');
    const snare: AnySourceId = liveSource('Drums', 'snare');
    v.push(on(36, 0.1), [liveSource('Drums'), kick]);
    v.advance(0.11, clock);
    expect(v.inputs(kick, false).vxHit).toBeGreaterThan(0.5);
    expect(v.inputs(liveSource('Drums'), false).vxHit).toBeGreaterThan(0.5);
    expect(v.inputs(snare, false).vxHit).toBe(0);
    // Another track, and the studio's own kick, stay dark.
    expect(v.inputs(liveSource('Bass'), false).vxHit).toBe(0);
    expect(v.inputs('kick', false).vxHit).toBe(0);
  });

  it('gives an audio track a continuous envelope from its level', () => {
    const v = new VoiceSignals();
    const pads = liveSource('Pads');
    v.setLevel(pads, 0.6);
    v.advance(1, clock);
    expect(v.inputs(pads, true).vxEnv).toBeCloseTo(0.6, 5);
    // Playing counts as present, so Auto voices show.
    expect(v.inputs(pads, true).vxPresence).toBeGreaterThan(0.9);
    v.setLevel(pads, 0);
    v.advance(1.01, clock);
    expect(v.inputs(pads, true).vxEnv).toBe(0);
  });

  it('forgets tracks that left the set', () => {
    const v = new VoiceSignals();
    v.setLevel(liveSource('Old'), 0.5);
    v.dropLiveSources(new Set([liveSource('New')]));
    expect(v.inputs(liveSource('Old'), false).vxEnv).toBe(0);
  });

  it('keep a voice\'s Live track through a save, and refuse junk', () => {
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick', live: 'live:Drums/kick' })?.live).toBe('live:Drums/kick');
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick', live: 'kick' })?.live).toBeUndefined();
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick', live: 42 })?.live).toBeUndefined();
  });
});

import { liveSceneFor, normalizeScene, studioSceneForLive } from './scenes';

describe('studio scenes and Live scenes', () => {
  const live = ['Intro', 'Verse', 'Drop', 'Outro'];
  it('go together by an explicit link, by name first, then by position', () => {
    expect(liveSceneFor({ name: 'Peak', liveScene: { name: 'Drop', index: 0 } }, live)).toBe(2);
    // Renamed in Live: the stored position still finds it.
    expect(liveSceneFor({ name: 'Peak', liveScene: { name: 'Gone', index: 1 } }, live)).toBe(1);
    expect(liveSceneFor({ name: 'Peak', liveScene: { name: 'Gone', index: 9 } }, live)).toBe(-1);
  });
  it('go together by a shared name when not linked', () => {
    expect(liveSceneFor({ name: 'drop ' }, live)).toBe(2);
    expect(liveSceneFor({ name: 'Arrival' }, live)).toBe(-1);
  });
  it('a Live scene brings its linked studio scene before a same-named one', () => {
    const scenes = [
      { id: 'named', name: 'Drop' },
      { id: 'linked', name: 'Peak', liveScene: { name: 'Drop', index: 2 } },
    ];
    expect(studioSceneForLive(scenes, 2, live)).toBe('linked');
    expect(studioSceneForLive(scenes.slice(0, 1), 2, live)).toBe('named');
    expect(studioSceneForLive(scenes, 0, live)).toBeNull();
  });
  it('keep their Live link through a save', () => {
    expect(normalizeScene({ id: 'a', name: 'Peak', liveScene: { name: 'Drop', index: 2 } })?.liveScene).toEqual({ name: 'Drop', index: 2 });
    expect(normalizeScene({ id: 'a', name: 'Peak', liveScene: { name: 'Drop', index: -1 } })?.liveScene).toBeUndefined();
  });
});
