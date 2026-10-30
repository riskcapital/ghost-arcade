import { describe, expect, it } from 'vitest';
import { importMidi, playingSong, takeSong } from './midiExport';
import { readMidiFile, writeMidiFile } from './midiFile';
import { starterPattern } from './drumPattern';
import type { RecordedLoop } from './loopRecorder';
import type { Take } from './recording';

const key = { root: 0, scale: 'minor' as const };

const recorded: RecordedLoop = {
  kind: 'recorded', id: 'r1', name: 'Dub bass 1', role: 'bass', instrument: 'dubbass', beats: 8, createdAt: 0,
  notes: [{ beat: 0, dur: 1, note: 36, velocity: 0.9 }, { beat: 4, dur: 1, note: 43, velocity: 0.8 }],
};

describe('playingSong', () => {
  it('writes the beat and each playing loop, repeated to the longest part', () => {
    const song = playingSong({ bpm: 128, key, set: 'dub', pattern: starterPattern(), playingLoops: { bass: 'r1', lead: 'lead-hypnotic' }, myLoops: [recorded] });
    expect(song.bpm).toBe(128);
    const [drums, ...parts] = song.tracks;
    expect(drums.channel).toBe(9);
    // A one-bar beat repeats to fill the eight-beat bass loop.
    expect(drums.notes.filter((n) => n.note === 36)).toHaveLength(8);
    const names = parts.map((t) => t.name);
    expect(names).toContain('Dub bass 1 (Dub bass)');
    expect(names.some((n) => n?.startsWith('Hypnotic three'))).toBe(true);
    // Survives the file format.
    expect(readMidiFile(writeMidiFile(song)).tracks).toHaveLength(3);
  });
});

describe('takeSong', () => {
  it('turns seconds into beats at the take tempo, a track per instrument', () => {
    const take: Take = {
      id: 't', name: 'Take 1', createdAt: 0, length: 2, bpm: 120, pattern: null,
      events: [
        { t: 0, type: 'on', instrument: 'keys', note: 60, velocity: 0.8 },
        { t: 0.5, type: 'off', instrument: 'keys', note: 60, velocity: 0 },
        { t: 1, type: 'on', instrument: 'drums', note: 36, velocity: 1 },
      ],
    };
    const song = takeSong(take);
    expect(song.tracks.map((t) => t.name)).toEqual(['Keys', 'Drums']);
    expect(song.tracks[0].notes[0]).toEqual({ beat: 0, dur: 1, note: 60, velocity: 0.8 });
    expect(song.tracks[1]).toMatchObject({ channel: 9, notes: [{ beat: 2, note: 36 }] });
  });
});

describe('importMidi', () => {
  it('makes a beat from the drum channel and loops from the other tracks', () => {
    let n = 0;
    const parts = importMidi(
      {
        bpm: 120,
        tracks: [
          { name: 'Beat', channel: 9, notes: [{ beat: 0, dur: 0.25, note: 36, velocity: 1 }, { beat: 1, dur: 0.25, note: 38, velocity: 0.7 }] },
          { name: 'Bassline', channel: 0, notes: [{ beat: 0, dur: 1, note: 33, velocity: 0.9 }, { beat: 5, dur: 1, note: 36, velocity: 0.9 }] },
        ],
      },
      'dub',
      'groove.mid',
      { myLoops: [], myBeats: [] },
      () => `id${n++}`,
    );
    expect(parts.beats).toHaveLength(1);
    expect(parts.beats[0].pattern.tracks.kick[0]).toBe(1);
    expect(parts.beats[0].pattern.tracks.snare[4]).toBe(0.7);
    expect(parts.loops).toHaveLength(1);
    expect(parts.loops[0]).toMatchObject({ name: 'Bassline 1', role: 'bass', instrument: 'dubbass', beats: 8 });
  });
});
