/**
 * Standard MIDI Files (.mid) for the music studio.
 *
 * Loops and takes are written as format 1 files any DAW can open, and format
 * 0 and 1 files can be read back in as loops. Times are in beats (quarter
 * notes) so the studio can play them at any tempo; the file's tempo travels
 * alongside as `bpm`.
 */

export interface MidiNote {
  /** Start, in beats from the start of the song. */
  beat: number;
  /** Length in beats. */
  dur: number;
  /** MIDI note number, 0..127. */
  note: number;
  /** 0..1. */
  velocity: number;
}

export interface MidiTrack {
  name?: string;
  /** MIDI channel 0..15 (default 0); 9 is the General MIDI drum channel. */
  channel?: number;
  notes: MidiNote[];
}

export interface MidiSong {
  bpm: number;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  tracks: MidiTrack[];
}

/** Ticks per beat in the files this module writes. */
export const MIDI_PPQ = 480;

const DEFAULT_BPM = 120;
const DEFAULT_BEATS_PER_BAR = 4;
const MICROSECONDS_PER_MINUTE = 60_000_000;
const MAX_VAR_LEN = 0x0fffffff;
const MAX_FILE_NAME_LENGTH = 100;

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const PROGRAM_CHANGE = 0xc0;
const CHANNEL_PRESSURE = 0xd0;
const SYSEX = 0xf0;
const SYSEX_ESCAPE = 0xf7;
const META = 0xff;
const META_TRACK_NAME = 0x03;
const META_END_OF_TRACK = 0x2f;
const META_SET_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;

// ---------------------------------------------------------------------------
// Writing

interface TrackEvent {
  tick: number;
  /** Tie-break within a tick: meta events, then note-offs, then note-ons. */
  order: 0 | 1 | 2;
  data: number[];
}

export function writeMidiFile(song: MidiSong): Uint8Array {
  const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(song.tracks.length + 1), ...u16(MIDI_PPQ)];
  const chunks = [header, trackChunk(conductorEvents(song)), ...song.tracks.map((track) => trackChunk(noteEvents(track)))];
  return Uint8Array.from(chunks.flat());
}

/** The first track of a format 1 file: tempo and time signature. */
function conductorEvents(song: MidiSong): TrackEvent[] {
  const bpm = Number.isFinite(song.bpm) && song.bpm > 0 ? song.bpm : DEFAULT_BPM;
  const microsecondsPerBeat = clampInt(MICROSECONDS_PER_MINUTE / bpm, 1, 0xffffff);
  const beatsPerBar = clampInt(song.beatsPerBar ?? DEFAULT_BEATS_PER_BAR, 1, 255);
  return [
    {
      tick: 0,
      order: 0,
      data: [META, META_SET_TEMPO, 3, (microsecondsPerBeat >> 16) & 0xff, (microsecondsPerBeat >> 8) & 0xff, microsecondsPerBeat & 0xff],
    },
    // beatsPerBar/4, a metronome click every beat, eight 32nd notes per beat.
    { tick: 0, order: 0, data: [META, META_TIME_SIGNATURE, 4, beatsPerBar, 2, 24, 8] },
  ];
}

function noteEvents(track: MidiTrack): TrackEvent[] {
  const channel = clampInt(track.channel ?? 0, 0, 15);
  const events: TrackEvent[] = [];
  if (track.name) {
    const name = Array.from(new TextEncoder().encode(track.name));
    events.push({ tick: 0, order: 0, data: [META, META_TRACK_NAME, ...varLen(name.length), ...name] });
  }
  for (const n of track.notes) {
    if (!Number.isFinite(n.beat) || !Number.isFinite(n.dur)) continue;
    const note = clampInt(n.note, 0, 127);
    const start = Math.max(0, beatToTick(n.beat));
    const end = Math.max(start + 1, beatToTick(n.beat + n.dur));
    events.push({ tick: start, order: 2, data: [NOTE_ON | channel, note, clampInt(n.velocity * 127, 1, 127)] });
    events.push({ tick: end, order: 1, data: [NOTE_OFF | channel, note, 64] });
  }
  return events;
}

function trackChunk(events: TrackEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let lastTick = 0;
  for (const event of sorted) {
    body.push(...varLen(event.tick - lastTick), ...event.data);
    lastTick = event.tick;
  }
  body.push(0, META, META_END_OF_TRACK, 0);
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

function beatToTick(beat: number): number {
  return Math.round(beat * MIDI_PPQ);
}

/** Rounds to an integer within [min, max]; NaN becomes min. */
function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Number.isNaN(rounded) ? min : Math.min(max, Math.max(min, rounded));
}

/** Seven bits per byte, most significant first, high bit set on all but the last. */
function varLen(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VAR_LEN) {
    throw new RangeError(`${value} does not fit in a MIDI variable-length number.`);
  }
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Reading

interface TickNote {
  start: number;
  end: number;
  note: number;
  velocity: number;
}

interface TimedValue {
  tick: number;
  value: number;
}

interface ParsedTrack {
  name?: string;
  notesByChannel: Map<number, TickNote[]>;
  /** The track's first Set Tempo, in microseconds per beat. */
  tempo?: TimedValue;
  /** The track's first time signature, as a bar length in beats. */
  barLength?: TimedValue;
}

export function readMidiFile(bytes: Uint8Array): MidiSong {
  const file = new ByteReader(bytes);
  if (bytes.length < 14 || file.ascii(4) !== 'MThd') {
    throw new Error('Not a MIDI file: it does not start with an MThd header.');
  }
  const headerLength = file.u32();
  if (headerLength < 6) throw new Error('Not a MIDI file: its header is too short.');
  const header = file.chunk(headerLength);
  const format = header.u16();
  header.u16(); // declared track count; the MTrk chunks themselves are what count
  const ticksPerBeat = header.u16();
  if (format > 1) throw new Error(`MIDI format ${format} files are not supported, only formats 0 and 1.`);
  if (ticksPerBeat & 0x8000) throw new Error('MIDI files timed in SMPTE frames are not supported.');
  if (ticksPerBeat === 0) throw new Error('Invalid MIDI file: it has zero ticks per beat.');

  const parsed: ParsedTrack[] = [];
  while (file.remaining >= 8) {
    const type = file.ascii(4);
    const chunk = file.chunk(file.u32());
    if (type === 'MTrk') parsed.push(parseTrack(chunk)); // other chunk types are skipped
  }

  const tempo = earliest(parsed.map((t) => t.tempo));
  const barLength = earliest(parsed.map((t) => t.barLength));
  const tracks: MidiTrack[] = [];
  for (const track of parsed) {
    for (const [channel, notes] of [...track.notesByChannel].sort(([a], [b]) => a - b)) {
      tracks.push({
        ...(track.name ? { name: track.name } : {}),
        channel,
        notes: notes
          .sort((a, b) => a.start - b.start || a.note - b.note || a.end - b.end)
          .map((n) => ({
            beat: n.start / ticksPerBeat,
            dur: (n.end - n.start) / ticksPerBeat,
            note: n.note,
            velocity: n.velocity / 127,
          })),
      });
    }
  }

  return {
    // Rounded so 90 bpm (666667 µs per beat) reads back as 90, not 89.99995.
    bpm: tempo ? Math.round((MICROSECONDS_PER_MINUTE / tempo.value) * 1000) / 1000 : DEFAULT_BPM,
    beatsPerBar: barLength?.value ?? DEFAULT_BEATS_PER_BAR,
    tracks,
  };
}

function parseTrack(track: ByteReader): ParsedTrack {
  const parsed: ParsedTrack = { notesByChannel: new Map() };
  // Notes still sounding, keyed by channel and pitch, oldest first.
  const sounding = new Map<number, { start: number; velocity: number }[]>();
  let tick = 0;
  let runningStatus = 0;

  const addNote = (channel: number, note: number, start: number, end: number, velocity: number) => {
    const notes = parsed.notesByChannel.get(channel) ?? [];
    notes.push({ start, end: Math.max(end, start + 1), note, velocity });
    parsed.notesByChannel.set(channel, notes);
  };

  while (track.remaining > 0) {
    tick += track.varLen();
    const byte = track.u8();

    if (byte === META) {
      const type = track.u8();
      const data = track.bytes(track.varLen());
      if (type === META_END_OF_TRACK) break;
      readMeta(parsed, type, data, tick);
      continue;
    }
    if (byte === SYSEX || byte === SYSEX_ESCAPE) {
      track.skip(track.varLen());
      continue;
    }

    let data1: number;
    if (byte & 0x80) {
      if (byte >= 0xf0) throw new Error(`Invalid MIDI track: unexpected status byte 0x${byte.toString(16)}.`);
      runningStatus = byte;
      data1 = track.u8() & 0x7f;
    } else {
      // Running status: the previous status still applies and this is its first data byte.
      if (!runningStatus) throw new Error('Invalid MIDI track: a data byte comes before any status byte.');
      data1 = byte;
    }
    const kind = runningStatus & 0xf0;
    const channel = runningStatus & 0x0f;
    const data2 = kind === PROGRAM_CHANGE || kind === CHANNEL_PRESSURE ? 0 : track.u8() & 0x7f;

    if (kind !== NOTE_ON && kind !== NOTE_OFF) continue;
    const key = channel * 128 + data1;
    if (kind === NOTE_ON && data2 > 0) {
      const started = sounding.get(key) ?? [];
      started.push({ start: tick, velocity: data2 });
      sounding.set(key, started);
    } else {
      // Note-off, or note-on at velocity 0: ends the oldest sounding note of that pitch.
      const started = sounding.get(key)?.shift();
      if (started) addNote(channel, data1, started.start, tick, started.velocity);
    }
  }

  // Notes never released end with the track.
  for (const [key, started] of sounding) {
    for (const s of started) addNote(Math.floor(key / 128), key % 128, s.start, tick, s.velocity);
  }
  return parsed;
}

function readMeta(track: ParsedTrack, type: number, data: Uint8Array, tick: number): void {
  if (type === META_TRACK_NAME && track.name === undefined) {
    track.name = decodeText(data) || undefined;
  } else if (type === META_SET_TEMPO && data.length >= 3 && !track.tempo) {
    const microsecondsPerBeat = (data[0] << 16) | (data[1] << 8) | data[2];
    if (microsecondsPerBeat > 0) track.tempo = { tick, value: microsecondsPerBeat };
  } else if (type === META_TIME_SIGNATURE && data.length >= 2 && !track.barLength) {
    // numerator / 2^power, in quarter-note beats: 6/8 is a 3-beat bar.
    const [numerator, power] = data;
    if (numerator > 0 && power <= 6) track.barLength = { tick, value: (numerator * 4) / 2 ** power };
  }
}

function earliest(values: (TimedValue | undefined)[]): TimedValue | undefined {
  let first: TimedValue | undefined;
  for (const value of values) if (value && (!first || value.tick < first.tick)) first = value;
  return first;
}

function decodeText(data: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = Array.from(data, (b) => String.fromCharCode(b)).join(''); // older files use Latin-1
  }
  return text.replace(/\0/g, '').trim();
}

class ByteReader {
  private readonly data: Uint8Array;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  u8(): number {
    this.need(1);
    return this.data[this.pos++];
  }

  u16(): number {
    return this.u8() * 0x100 + this.u8();
  }

  u32(): number {
    return this.u8() * 0x1000000 + this.u8() * 0x10000 + this.u8() * 0x100 + this.u8();
  }

  varLen(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid MIDI file: a variable-length number runs past four bytes.');
  }

  bytes(length: number): Uint8Array {
    this.need(length);
    const out = this.data.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  chunk(length: number): ByteReader {
    return new ByteReader(this.bytes(length));
  }

  skip(length: number): void {
    this.bytes(length);
  }

  ascii(length: number): string {
    return Array.from(this.bytes(length), (b) => String.fromCharCode(b)).join('');
  }

  private need(length: number): void {
    if (length > this.remaining) throw new Error('Invalid MIDI file: it ends part-way through a chunk.');
  }
}

// ---------------------------------------------------------------------------
// File names

/** A file name that is safe on every desktop OS, ending in .mid. */
export function midiFileName(name: string): string {
  const trimEdges = (text: string) => text.replace(/^[\s.]+|[\s.]+$/g, '');
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.midi?$/i, '');
  let base = trimEdges(trimEdges(cleaned).slice(0, MAX_FILE_NAME_LENGTH));
  if (!base) base = 'untitled';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base.split('.')[0])) base = `_${base}`;
  return `${base}.mid`;
}
