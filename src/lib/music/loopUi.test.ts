import { describe, expect, it } from 'vitest';
import { buttonLabel, buttonTone, stateLine, trackProgress } from './loopUi';
import type { TrackView } from './loopStation';

const view = (v: Partial<TrackView>): TrackView => ({ phase: 'empty', startBeat: 0, endBeat: null, origin: 0, beats: 0, layers: 0, redo: 0, pending: null, waiting: false, waitOrigin: 0, waitBeats: 0, setsTempo: false, noInput: false, ...v });

describe('the track button, as a hardware looper shows it', () => {
  it('armed, recording, overdubbing and playing each have their own colour', () => {
    expect(buttonTone(view({ phase: 'armed' }))).toBe('armed');
    expect(buttonTone(view({ phase: 'record' }))).toBe('rec');
    expect(buttonTone(view({ phase: 'overdub' }))).toBe('dub');
    expect(buttonTone(view({ phase: 'overdub', pending: 'punch-in' }))).toBe('play');
    expect(buttonTone(view({ phase: 'play' }))).toBe('play');
    expect(buttonTone(view({ phase: 'play' }), true)).toBe('muted');
  });

  it('counts in by beats, waits for the first note, then counts bars', () => {
    expect(buttonLabel(view({ phase: 'armed', startBeat: 8, waiting: true }), 5.5)).toBe('In 3');
    expect(buttonLabel(view({ phase: 'armed', startBeat: 8, waiting: true }), 9)).toBe('Ready');
    expect(buttonLabel(view({ phase: 'record', startBeat: 8, endBeat: 24 }), 13)).toBe('Bar 2/4');
    expect(buttonLabel(view({ phase: 'record', startBeat: 8, endBeat: null }), 21)).toBe('Bar 4');
    expect(stateLine(view({ phase: 'armed', startBeat: 0, waiting: true }), 3)).toBe('Waiting for your first note');
  });

  it('says what waits for its bar', () => {
    expect(buttonLabel(view({ phase: 'play', pending: 'stop' }), 0)).toBe('Stop…');
    expect(buttonLabel(view({ phase: 'overdub', pending: 'punch-out' }), 0)).toBe('End dub…');
    expect(buttonLabel(view({ phase: 'play', pending: 'play' }), 0)).toBe('Start…');
  });

  it('while waiting over playing loops, the playhead runs round them', () => {
    expect(trackProgress(view({ phase: 'armed', waiting: true, waitOrigin: 4, waitBeats: 16 }), 12)).toBeCloseTo(0.5, 6);
  });
});
