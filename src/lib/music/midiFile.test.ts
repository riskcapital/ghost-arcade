import { describe, expect, it } from 'vitest';
import { MIDI_PPQ, midiFileName, readMidiFile, writeMidiFile, type MidiNote, type MidiSong } from './midiFile';

const TICK = 1 / MIDI_PPQ;

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
const u32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const chunk = (type: string, body: number[]) => [...ascii(type), ...u32(body.length), ...body];
const header = (format: number, trackCount: number, ppq: number) => chunk('MThd', [...u16(format), ...u16(trackCount), ...u16(ppq)]);

/** A hand-built file: a header plus one MTrk chunk per track body. */
function smf(format: number, ppq: number, ...tracks: number[][]): Uint8Array {
  return Uint8Array.from([...header(format, tracks.length, ppq), ...tracks.flatMap((body) => chunk('MTrk', body))]);
}

function chunksOf(bytes: Uint8Array): { type: string; body: number[] }[] {
  const chunks: { type: string; body: number[] }[] = [];
  for (let at = 0; at + 8 <= bytes.length; ) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0);
    chunks.push({ type, body: Array.from(bytes.subarray(at + 8, at + 8 + length)) });
    at += 8 + length;
  }
  return chunks;
}

function containsRun(haystack: number[], needle: number[]): boolean {
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b));
}

function expectSameNotes(actual: MidiNote[], expected: MidiNote[]): void {
  const sorted = [...expected].sort((a, b) => a.beat - b.beat || a.note - b.note || a.dur - b.dur);
  expect(actual).toHaveLength(sorted.length);
  sorted.forEach((want, i) => {
    const got = actual[i];
    expect(got.note).toBe(want.note);
    expect(Math.abs(got.beat - want.beat)).toBeLessThanOrEqual(TICK);
    expect(Math.abs(got.dur - want.dur)).toBeLessThanOrEqual(TICK);
    expect(Math.abs(got.velocity - want.velocity)).toBeLessThanOrEqual(0.5 / 127 + 1e-9);
  });
}

const BAND: MidiSong = {
  bpm: 96,
  beatsPerBar: 4,
  tracks: [
    {
      name: 'Bass',
      channel: 1,
      notes: [
        { beat: 0, dur: 0.5, note: 36, velocity: 1 },
        { beat: 0.75, dur: 0.25, note: 36, velocity: 0.6 },
        { beat: 1 / 3, dur: 1 / 3, note: 43, velocity: 0.33 },
        { beat: 2.0007, dur: 0.33337, note: 39, velocity: 0.8 },
      ],
    },
    {
      name: 'Chords',
      channel: 2,
      notes: [
        { beat: 4, dur: 4, note: 60, velocity: 0.7 },
        { beat: 4, dur: 4, note: 63, velocity: 0.7 },
        { beat: 4, dur: 4, note: 67, velocity: 0.7 },
        // Same pitch, overlapping.
        { beat: 8, dur: 2, note: 60, velocity: 0.9 },
        { beat: 9, dur: 2, note: 60, velocity: 0.4 },
      ],
    },
    {
      name: 'Drums',
      channel: 9,
      notes: [0, 1, 2, 3].flatMap((beat) => [
        { beat, dur: 0.1, note: 36, velocity: 1 },
        { beat: beat + 0.5, dur: 0.1, note: 42, velocity: 0.5 },
      ]),
    },
  ],
};

describe('writing', () => {
  it('writes the exact bytes of a one-note song', () => {
    const bytes = writeMidiFile({ bpm: 120, tracks: [{ notes: [{ beat: 0, dur: 1, note: 60, velocity: 1 }] }] });
    expect(Array.from(bytes)).toEqual([
      ...ascii('MThd'), 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0,
      ...ascii('MTrk'), 0, 0, 0, 0x13,
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 500000 µs per beat
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 4/4
      0x00, 0xff, 0x2f, 0x00,
      ...ascii('MTrk'), 0, 0, 0, 0x0d,
      0x00, 0x90, 0x3c, 0x7f,
      0x83, 0x60, 0x80, 0x3c, 0x40, // 480 ticks later
      0x00, 0xff, 0x2f, 0x00,
    ]);
  });

  it('writes a format 1 file with a tempo track plus one track per part', () => {
    const chunks = chunksOf(writeMidiFile(BAND));
    expect(chunks.map((c) => c.type)).toEqual(['MThd', 'MTrk', 'MTrk', 'MTrk', 'MTrk']);
    expect(chunks[0].body).toEqual([0, 1, 0, 4, ...u16(MIDI_PPQ)]);
    expect(containsRun(chunks[2].body, [0x00, 0xff, 0x03, 4, ...ascii('Bass')])).toBe(true);
    expect(chunks[4].body.filter((b) => b === 0x99)).toHaveLength(8); // note-ons on the drum channel
  });

  it('sorts events by tick and puts note-offs before note-ons on the same tick', () => {
    const bytes = writeMidiFile({
      bpm: 120,
      tracks: [
        {
          notes: [
            { beat: 1, dur: 1, note: 60, velocity: 1 },
            { beat: 0, dur: 1, note: 60, velocity: 1 },
          ],
        },
      ],
    });
    expect(chunksOf(bytes)[2].body).toEqual([
      0x00, 0x90, 0x3c, 0x7f,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0x90, 0x3c, 0x7f,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ]);
  });

  it('never writes a silent note-on or a note shorter than a tick', () => {
    const bytes = writeMidiFile({
      bpm: 120,
      tracks: [
        {
          notes: [
            { beat: 0, dur: 0, note: 60, velocity: 0 },
            { beat: 1, dur: -1, note: 300, velocity: 5 },
            { beat: -2, dur: 3, note: -4, velocity: 0.5 },
          ],
        },
      ],
    });
    const body = chunksOf(bytes)[2].body;
    expect(containsRun(body, [0x90, 60, 1])).toBe(true);
    expect(containsRun(body, [0x90, 127, 127])).toBe(true);

    const [track] = readMidiFile(bytes).tracks;
    expect(track.notes).toEqual([
      { beat: 0, dur: 1, note: 0, velocity: 64 / 127 },
      { beat: 0, dur: TICK, note: 60, velocity: 1 / 127 },
      { beat: 1, dur: TICK, note: 127, velocity: 1 },
    ]);
  });

  it('encodes long gaps as multi-byte variable-length numbers', () => {
    const at = (beat: number): MidiSong => ({ bpm: 120, tracks: [{ notes: [{ beat, dur: 1, note: 60, velocity: 1 }] }] });
    expect(containsRun(chunksOf(writeMidiFile(at(16384 / MIDI_PPQ)))[2].body, [0x81, 0x80, 0x00, 0x90])).toBe(true);

    const far = writeMidiFile(at(200_000)); // 96,000,000 ticks
    expect(containsRun(chunksOf(far)[2].body, [0xad, 0xe3, 0xb0, 0x00, 0x90])).toBe(true);
    expectSameNotes(readMidiFile(far).tracks[0].notes, at(200_000).tracks[0].notes);

    expect(() => writeMidiFile(at(1_000_000))).toThrow(RangeError);
  });
});

describe('round trip', () => {
  it('reads back the same notes, names and channels within a tick', () => {
    const song = readMidiFile(writeMidiFile(BAND));
    expect(song.bpm).toBe(96);
    expect(song.beatsPerBar).toBe(4);
    expect(song.tracks.map((t) => [t.name, t.channel])).toEqual([
      ['Bass', 1],
      ['Chords', 2],
      ['Drums', 9],
    ]);
    song.tracks.forEach((track, i) => expectSameNotes(track.notes, BAND.tracks[i].notes));
  });

  it('keeps tempo and bar length', () => {
    for (const bpm of [60, 90, 120, 128.5, 174]) {
      expect(readMidiFile(writeMidiFile({ bpm, tracks: [] })).bpm).toBe(bpm);
    }
    expect(readMidiFile(writeMidiFile({ bpm: 120, beatsPerBar: 3, tracks: [] })).beatsPerBar).toBe(3);
    expect(readMidiFile(writeMidiFile({ bpm: 120, beatsPerBar: 7, tracks: [] })).beatsPerBar).toBe(7);
  });

  it('keeps tracks on the same channel apart and drops tracks with no notes', () => {
    const song = readMidiFile(
      writeMidiFile({
        bpm: 120,
        tracks: [
          { name: 'Lead', notes: [{ beat: 0, dur: 1, note: 72, velocity: 1 }] },
          { name: 'Empty', notes: [] },
          { name: 'Pad', notes: [{ beat: 0, dur: 4, note: 48, velocity: 0.5 }] },
        ],
      }),
    );
    expect(song.tracks.map((t) => [t.name, t.channel, t.notes.length])).toEqual([
      ['Lead', 0, 1],
      ['Pad', 0, 1],
    ]);
  });

  it('keeps names that are not plain ASCII', () => {
    const song = readMidiFile(writeMidiFile({ bpm: 120, tracks: [{ name: 'Café ♫', notes: [{ beat: 0, dur: 1, note: 60, velocity: 1 }] }] }));
    expect(song.tracks[0].name).toBe('Café ♫');
  });
});

describe('reading', () => {
  it('follows running status, including note-on at velocity 0 as note-off', () => {
    const bytes = smf(0, 96, [
      0x00, 0xff, 0x03, 4, ...ascii('Lead'),
      0x00, 0xc0, 5, // program change: one data byte
      0x00, 0xf0, 3, 0x7e, 0x7f, 0xf7, // sysex
      0x00, 0x90, 60, 100,
      0x00, 64, 90, // running status note-on
      0x60, 60, 0, // 96 ticks later: note-on at velocity 0 ends 60
      0x00, 64, 0,
      0x00, 0xb0, 7, 100, // controller
      0x00, 10, 64, // running status controller, not a note
      0x00, 0x90, 67, 127,
      0x00, 71, 127,
      0x81, 0x40, 0x80, 67, 64, // 192 ticks later
      0x00, 71, 64, // running status note-off
      0x00, 0xff, 0x2f, 0x00,
    ]);
    const song = readMidiFile(bytes);
    expect(song.bpm).toBe(120);
    expect(song.beatsPerBar).toBe(4);
    expect(song.tracks).toEqual([
      {
        name: 'Lead',
        channel: 0,
        notes: [
          { beat: 0, dur: 1, note: 60, velocity: 100 / 127 },
          { beat: 0, dur: 1, note: 64, velocity: 90 / 127 },
          { beat: 1, dur: 2, note: 67, velocity: 1 },
          { beat: 1, dur: 2, note: 71, velocity: 1 },
        ],
      },
    ]);
  });

  it('splits a format 0 file into a track per channel, drums included', () => {
    const track = [
      0x00, 0xff, 0x03, 6, ...ascii('Groove'),
      0x00, 0xff, 0x51, 0x03, 0x06, 0x8a, 0x1b, // 428571 µs per beat: 140 bpm
      0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
      0x00, 0x90, 48, 100,
      0x00, 0x99, 36, 127,
      0x78, 0x89, 36, 0, // tick 120
      0x78, 0x99, 38, 80, // tick 240
      0x00, 0x80, 48, 0,
      0x3c, 0x89, 38, 0, // tick 300
      0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, // a later tempo change is not the song's tempo
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bytes = Uint8Array.from([...header(0, 1, 240), ...chunk('XFIH', [1, 2, 3]), ...chunk('MTrk', track)]);
    expect(readMidiFile(bytes)).toEqual({
      bpm: 140,
      beatsPerBar: 3,
      tracks: [
        { name: 'Groove', channel: 0, notes: [{ beat: 0, dur: 1, note: 48, velocity: 100 / 127 }] },
        {
          name: 'Groove',
          channel: 9,
          notes: [
            { beat: 0, dur: 0.5, note: 36, velocity: 1 },
            { beat: 1, dur: 0.25, note: 38, velocity: 80 / 127 },
          ],
        },
      ],
    });
  });

  it('takes the tempo from the earliest Set Tempo in a format 1 file', () => {
    const bytes = smf(
      1,
      96,
      [0x60, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, 0x00, 0xff, 0x2f, 0x00], // 60 bpm at tick 96
      [0x00, 0xff, 0x51, 0x03, 0x09, 0x27, 0xc0, 0x00, 0xff, 0x2f, 0x00], // 100 bpm at tick 0
    );
    expect(readMidiFile(bytes).bpm).toBe(100);
  });

  it('pairs overlapping notes of the same pitch first in, first out', () => {
    const bytes = smf(0, 96, [
      0x00, 0x90, 60, 100,
      0x60, 0x90, 60, 50,
      0x60, 0x80, 60, 0,
      0x60, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]);
    expect(readMidiFile(bytes).tracks[0].notes).toEqual([
      { beat: 0, dur: 2, note: 60, velocity: 100 / 127 },
      { beat: 1, dur: 2, note: 60, velocity: 50 / 127 },
    ]);
  });

  it('gives zero-length notes one tick and ends unreleased notes with their track', () => {
    const bytes = smf(0, 96, [
      0x00, 0x90, 60, 100,
      0x00, 0x90, 62, 100,
      0x00, 0x80, 62, 0,
      0x81, 0x40, 0xff, 0x2f, 0x00, // end of track at tick 192
    ]);
    expect(readMidiFile(bytes).tracks[0].notes).toEqual([
      { beat: 0, dur: 2, note: 60, velocity: 100 / 127 },
      { beat: 0, dur: 1 / 96, note: 62, velocity: 100 / 127 },
    ]);
  });

  it('reads compound time signatures as a bar length in beats', () => {
    const sixEight = smf(0, 96, [0x00, 0xff, 0x58, 0x04, 0x06, 0x03, 0x24, 0x08, 0x00, 0xff, 0x2f, 0x00]);
    expect(readMidiFile(sixEight).beatsPerBar).toBe(3);
  });

  it('rejects files that are not MIDI', () => {
    expect(() => readMidiFile(new Uint8Array())).toThrow(/Not a MIDI file/);
    expect(() => readMidiFile(new TextEncoder().encode('definitely not a midi file'))).toThrow(/Not a MIDI file/);
    expect(() => readMidiFile(Uint8Array.from([...ascii('RIFF'), 36, 0, 0, 0, ...ascii('WAVEfmt '), 16, 0, 0, 0]))).toThrow(/Not a MIDI file/);
    expect(() => readMidiFile(Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff))).toThrow(/Not a MIDI file/);
  });

  it('rejects MIDI files it cannot read', () => {
    expect(() => readMidiFile(smf(2, 96, [0x00, 0xff, 0x2f, 0x00]))).toThrow(/format 2/);
    expect(() => readMidiFile(smf(1, 0xe728, [0x00, 0xff, 0x2f, 0x00]))).toThrow(/SMPTE/);
    expect(() => readMidiFile(smf(0, 0, [0x00, 0xff, 0x2f, 0x00]))).toThrow(/zero ticks/);
    expect(() => readMidiFile(smf(0, 96, [0x00, 60, 100]))).toThrow(/before any status byte/);
    expect(() => readMidiFile(smf(0, 96, [0x00, 0xf2, 0, 0]))).toThrow(/unexpected status byte/);

    const whole = writeMidiFile(BAND);
    expect(() => readMidiFile(whole.subarray(0, whole.length - 5))).toThrow(/ends part-way/);
  });
});

describe('file names', () => {
  it('ends in .mid without doubling the extension', () => {
    expect(midiFileName('Night Drive')).toBe('Night Drive.mid');
    expect(midiFileName('groove.mid')).toBe('groove.mid');
    expect(midiFileName('groove.MIDI')).toBe('groove.mid');
  });

  it('drops characters file systems reject', () => {
    expect(midiFileName('Take 1: Bass/Drums?')).toBe('Take 1 Bass Drums.mid');
    expect(midiFileName('  ..hidden..  ')).toBe('hidden.mid');
    expect(midiFileName('tab\there')).toBe('tab here.mid');
  });

  it('falls back to a name when nothing usable is left', () => {
    expect(midiFileName('')).toBe('untitled.mid');
    expect(midiFileName('???')).toBe('untitled.mid');
  });

  it('steers clear of reserved Windows names and very long names', () => {
    expect(midiFileName('con')).toBe('_con.mid');
    expect(midiFileName('LPT1')).toBe('_LPT1.mid');
    expect(midiFileName('x'.repeat(300))).toBe(`${'x'.repeat(100)}.mid`);
  });
});
