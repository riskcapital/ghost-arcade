import { describe, expect, it } from 'vitest';
import {
  PlayedNotes,
  capturePhrase,
  loopBars,
  nextRecordedName,
  normalizeRecordedBeat,
  normalizeRecordedLoop,
  patternLengthFor,
  quantizeBeat,
  recordedNotesBetween,
  roleForRecording,
  stepForBeat,
  takeLoop,
  writeHits,
  type RecordedLoop,
} from './loopRecorder';
import { createPattern } from './drumPattern';

function played(list: Array<[number, number | null, number?]>, instrument: 'synth' | 'keys' | 'dubbass' = 'synth') {
  const p = new PlayedNotes();
  for (const [beat, end, note = 60] of list) {
    p.noteOn(instrument, note, 0.8, beat);
    if (end !== null) p.noteOff(instrument, note, end);
  }
  return p;
}

describe('quantizeBeat', () => {
  it('snaps to the grid and wraps a note snapped onto the end back to the start', () => {
    expect(quantizeBeat(1.13, 0.25, 4)).toBe(1.25);
    expect(quantizeBeat(3.9, 0.25, 4)).toBe(0);
    expect(quantizeBeat(1.13, 0, 4)).toBeCloseTo(1.13);
    expect(quantizeBeat(-0.05, 0.25, 4)).toBe(0);
  });
});

describe('takeLoop', () => {
  it('cuts notes to the bars, relative to the start, and trims held notes at the end', () => {
    const p = played([[8.02, 9, 60], [10, null, 64], [11.5, 13, 67], [12.5, 13, 72]]);
    const take = takeLoop(p.all(), 8, 4, 0.25);
    const notes = take.melodic.get('synth')!;
    expect(notes.map((n) => [n.beat, n.note])).toEqual([[0, 60], [2, 64], [3.5, 67]]);
    // Still held at the end: it lasts to the end of the loop.
    expect(notes[1].dur).toBeCloseTo(2);
    // Held past the end: trimmed so it ends with the loop.
    expect(notes[2].beat + notes[2].dur).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('counts a note played just before the first bar as on it', () => {
    const p = played([[7.95, 8.5]]);
    expect(takeLoop(p.all(), 8, 4, 0).melodic.get('synth')![0].beat).toBe(0);
  });

  it('keeps drum hits apart, on sixteenths, in clock beats', () => {
    const p = new PlayedNotes();
    p.hit('kick', 36, 1, 8.04);
    p.hit('hatClosed', 42, 0.5, 9.38);
    const take = takeLoop(p.all(), 8, 4, 0);
    expect(take.melodic.size).toBe(0);
    expect(take.hits).toEqual([
      { beat: 8, voice: 'kick', velocity: 1 },
      { beat: 9.5, voice: 'hatClosed', velocity: 0.5 },
    ]);
  });
});

describe('capturePhrase', () => {
  it('keeps the phrase since the last long pause, in whole bars', () => {
    // An old note, a long gap, then a phrase from bar 5 (beat 16) into bar 6.
    const p = played([[2, 3], [16.1, 16.5], [17, 18], [21, 21.5]]);
    expect(capturePhrase(p.all(), 22)).toEqual({ startBeat: 16, beats: 8 });
  });

  it('stretches to a power-of-two bar count', () => {
    const p = played([[0, 1], [4, 5], [8.2, 9]]);
    // Three bars of playing become a four-bar loop.
    expect(capturePhrase(p.all(), 10)).toEqual({ startBeat: 0, beats: 16 });
  });

  it('returns null with nothing played recently', () => {
    expect(capturePhrase(new PlayedNotes().all(), 10)).toBeNull();
    expect(capturePhrase(played([[0, 1]]).all(), 1000)).toBeNull();
  });
});

describe('loopBars', () => {
  it('rounds up to 1, 2, 4, 8 or 16 bars', () => {
    expect([1, 2, 3, 5, 9, 40].map(loopBars)).toEqual([1, 2, 4, 8, 16, 16]);
  });
});

describe('roleForRecording', () => {
  const n = (beat: number, note: number) => ({ beat, dur: 0.5, note, velocity: 0.8 });
  it('follows the instrument where it has one part', () => {
    expect(roleForRecording('dubbass', [])).toBe('bass');
    expect(roleForRecording('bowls', [])).toBe('texture');
    expect(roleForRecording('drone', [])).toBe('chords');
  });
  it('tells chords, bass and lead apart for the keyboards', () => {
    expect(roleForRecording('keys', [n(0, 60), n(0, 64), n(0, 67), n(2, 62), n(2, 65)])).toBe('chords');
    expect(roleForRecording('synth', [n(0, 36), n(1, 38), n(2, 41)])).toBe('bass');
    expect(roleForRecording('synth', [n(0, 72), n(1, 74), n(2, 76)])).toBe('lead');
  });
});

describe('recordedNotesBetween', () => {
  const loop: RecordedLoop = {
    kind: 'recorded', id: 'a', name: 'Synth 1', role: 'lead', instrument: 'synth', beats: 4, createdAt: 0,
    notes: [{ beat: 0, dur: 0.5, note: 60, velocity: 0.8 }, { beat: 2, dur: 0.5, note: 67, velocity: 0.7 }],
  };
  it('repeats the notes every loop from its start', () => {
    expect(recordedNotesBetween(loop, 8, 9, 15).map((n) => [n.beat, n.note])).toEqual([[10, 67], [12, 60], [14, 67]]);
  });
  it('plays nothing before the start', () => {
    expect(recordedNotesBetween(loop, 8, 0, 8)).toEqual([]);
  });
});

describe('writing hits into the grid', () => {
  it('lands each hit on its nearest step as the pattern loops from beat 0', () => {
    const p = createPattern(16);
    expect(stepForBeat(p, 4.02)).toBe(0);
    expect(stepForBeat(p, 5.24)).toBe(5);
    const next = writeHits(p, [{ beat: 5.24, voice: 'snare', velocity: 0.7 }, { beat: 4.02, voice: 'kick', velocity: 1 }]);
    expect(next.tracks.snare[5]).toBe(0.7);
    expect(next.tracks.kick[0]).toBe(1);
    expect(p.tracks.kick[0]).toBe(0);
  });

  it('keeps the louder hit on a step', () => {
    const p = writeHits(createPattern(16), [{ beat: 0, voice: 'kick', velocity: 1 }]);
    expect(writeHits(p, [{ beat: 0, voice: 'kick', velocity: 0.3 }]).tracks.kick[0]).toBe(1);
  });

  it('grows a short grid to hold a longer recording', () => {
    expect(patternLengthFor(8)).toBe(32);
    const grown = writeHits(createPattern(16), [{ beat: 6, voice: 'tom', velocity: 0.8 }], 8);
    expect(grown.steps).toBe(32);
    expect(grown.tracks.tom[24]).toBe(0.8);
  });
});

describe('names and project data', () => {
  it('numbers recorded loops per instrument', () => {
    expect(nextRecordedName([{ name: 'Dub bass 1' }, { name: 'Dub bass 2' }, { name: 'Keys 4' }], 'Dub bass')).toBe('Dub bass 3');
    expect(nextRecordedName([], 'Acid')).toBe('Acid 1');
  });

  it('normalizes a saved loop and drops notes outside it', () => {
    const loop = normalizeRecordedLoop({
      id: 'x', instrument: 'keys', beats: 8, name: '  Mine ',
      notes: [{ beat: 1, dur: 0.5, note: 200, velocity: 3 }, { beat: 9, dur: 1, note: 60, velocity: 0.5 }, 'junk'],
    })!;
    expect(loop.kind).toBe('recorded');
    expect(loop.name).toBe('Mine');
    expect(loop.notes).toEqual([{ beat: 1, dur: 0.5, note: 127, velocity: 1 }]);
    expect(loop.role).toBe('lead');
    expect(normalizeRecordedLoop({ id: 'y', instrument: 'nope' })).toBeNull();
    expect(normalizeRecordedLoop(null)).toBeNull();
  });

  it('normalizes a kept beat', () => {
    const beat = normalizeRecordedBeat({ id: 'b', name: 'Groove', pattern: { steps: 32 } })!;
    expect(beat.pattern.steps).toBe(32);
    expect(normalizeRecordedBeat({ id: 'b' })).toBeNull();
  });
});
