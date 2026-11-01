/** A scene keeps the whole sound and the visual voices, and they survive a save and load. */

import { describe, expect, it } from 'vitest';
import { defaultProjectState, normalizeProjectState, sceneSound } from './musicStudioStore';
import { captureSetup } from './songs';

describe('a saved scene', () => {
  it('keeps its set, tones, kit and pads, and its visual voices, through a save and load', () => {
    const state = { ...defaultProjectState(), set: 'dub' as const, synthTone: 'bass.envelope-funk', drumKit: 'kit.punch' };
    const voices = [{ file: 'VX-Barcode.fs', source: 'kick', auto: true, level: 0.7, blend: 'add', params: { columns: 300 } }];
    const scene = {
      id: 's1', name: 'Skank', pattern: null, beat: true, takeId: null, vjColumn: null, loops: {},
      sound: sceneSound(captureSetup(state)), voices,
    };
    const saved = JSON.parse(JSON.stringify({ ...state, scenes: [scene] }));
    const back = normalizeProjectState(saved).scenes[0];
    expect(back.sound).toMatchObject({ set: 'dub', synthTone: 'bass.envelope-funk', drumKit: 'kit.punch' });
    expect(back.sound && 'liveInputs' in back.sound).toBe(false);
    expect(back.voices).toEqual([expect.objectContaining({ file: 'VX-Barcode.fs', source: 'kick', level: 0.7, blend: 'add' })]);
  });

  it('opens an older scene with neither, leaving the sound alone', () => {
    const back = normalizeProjectState({ scenes: [{ id: 'old', name: 'Old', beat: false, loops: {} }] }).scenes[0];
    expect(back.sound).toBeUndefined();
    expect(back.voices).toBeUndefined();
  });
});
