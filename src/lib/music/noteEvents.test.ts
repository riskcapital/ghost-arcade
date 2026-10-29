import { describe, expect, it, vi } from 'vitest';
import {
  DRUM_NOTES,
  DRUM_VOICES,
  HeldNotes,
  createNoteBus,
  drumVoiceForNote,
  noteName,
  noteOff,
  noteOn,
} from './noteEvents';
import { parseMidiNoteMessage } from './midiNotes';
import {
  DRUM_PAD_KEYS,
  drumPadForKey,
  keyForNote,
  keyboardAction,
  noteForKey,
} from './keyboardLayout';

describe('note events', () => {
  it('carries pitch, velocity, instrument and drum voice', () => {
    const on = noteOn('drums', 38, 0.7, 'midi', 1.5);
    expect(on).toEqual({ type: 'on', instrument: 'drums', note: 38, velocity: 0.7, drum: 'snare', source: 'midi', time: 1.5 });
    const off = noteOff('synth', 60, 'keyboard', 2);
    expect(off).toMatchObject({ type: 'off', instrument: 'synth', note: 60, velocity: 0, drum: undefined });
  });

  it('clamps out-of-range pitch and velocity', () => {
    expect(noteOn('synth', 200, 3, 'screen', 0)).toMatchObject({ note: 127, velocity: 1 });
    expect(noteOn('synth', -4, Number.NaN, 'screen', 0)).toMatchObject({ note: 0, velocity: 0 });
  });

  it('maps General MIDI drum notes onto the kit and folds the rest onto the pads', () => {
    for (const voice of DRUM_VOICES) expect(drumVoiceForNote(DRUM_NOTES[voice])).toBe(voice);
    expect(drumVoiceForNote(35)).toBe('kick');
    expect(drumVoiceForNote(44)).toBe('hatClosed');
    expect(DRUM_VOICES).toContain(drumVoiceForNote(100));
  });

  it('names notes with middle C as C4', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(21)).toBe('A0');
  });

  it('delivers to every listener even when one throws', () => {
    const bus = createNoteBus();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    bus.subscribe(() => { throw new Error('bad listener'); });
    const stop = bus.subscribe((e) => seen.push(`${e.type}${e.note}`));
    bus.emit(noteOn('keys', 64, 1, 'screen', 0));
    stop();
    bus.emit(noteOff('keys', 64, 'screen', 0));
    expect(seen).toEqual(['on64']);
    warn.mockRestore();
  });
});

describe('held notes', () => {
  it('only reports the first on and the last off of a pitch held twice', () => {
    const held = new HeldNotes();
    expect(held.apply(noteOn('synth', 60, 1, 'keyboard', 0))).toBe(true);
    expect(held.apply(noteOn('synth', 60, 1, 'midi', 0))).toBe(false);
    expect(held.apply(noteOff('synth', 60, 'keyboard', 0))).toBe(false);
    expect(held.isHeld('synth', 60)).toBe(true);
    expect(held.apply(noteOff('synth', 60, 'midi', 0))).toBe(true);
    expect(held.isHeld('synth', 60)).toBe(false);
  });

  it('ignores an off for a note that is not down', () => {
    const held = new HeldNotes();
    expect(held.apply(noteOff('keys', 50, 'midi', 0))).toBe(false);
  });

  it('keeps instruments apart', () => {
    const held = new HeldNotes();
    held.apply(noteOn('synth', 60, 1, 'keyboard', 0));
    held.apply(noteOn('keys', 64, 1, 'keyboard', 0));
    held.apply(noteOn('synth', 55, 1, 'keyboard', 0));
    expect(held.notes('synth')).toEqual([55, 60]);
    expect(held.notes('keys')).toEqual([64]);
    expect(held.all()).toHaveLength(3);
  });
});

describe('letter keyboard', () => {
  it('plays a piano layout from the home row', () => {
    expect(noteForKey('KeyA', 4)).toBe(60);
    expect(noteForKey('KeyW', 4)).toBe(61);
    expect(noteForKey('KeyK', 4)).toBe(72);
    expect(noteForKey('Quote', 4)).toBe(77);
    expect(noteForKey('KeyA', 2)).toBe(36);
    expect(noteForKey('KeyQ', 4)).toBeNull();
  });

  it('finds the key for a note so the on-screen keys can show it', () => {
    expect(keyForNote(64, 4)).toBe('KeyD');
    expect(keyForNote(59, 4)).toBeNull();
  });

  it('shifts octave and velocity with Z X C V', () => {
    expect(keyboardAction('KeyZ', 4)).toEqual({ kind: 'octave', delta: -1 });
    expect(keyboardAction('KeyX', 4)).toEqual({ kind: 'octave', delta: 1 });
    expect(keyboardAction('KeyC', 4)).toMatchObject({ kind: 'velocity' });
    expect(keyboardAction('KeyV', 4)).toMatchObject({ kind: 'velocity' });
    expect(keyboardAction('Digit1', 4)).toBeNull();
  });

  it('keeps notes inside the MIDI range at the top octave', () => {
    expect(noteForKey('KeyA', 9)).toBe(120);
    expect(noteForKey('Quote', 9)).toBeNull();
  });

  it('plays the eight drum pads from the home row', () => {
    expect(DRUM_PAD_KEYS.map(drumPadForKey)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(drumPadForKey('KeyW')).toBeNull();
  });
});

describe('MIDI note messages', () => {
  it('reads note-on, note-off and velocity-0 note-on', () => {
    expect(parseMidiNoteMessage([0x90, 60, 127])).toEqual({ kind: 'on', channel: 0, note: 60, velocity: 1 });
    expect(parseMidiNoteMessage([0x99, 36, 64])).toMatchObject({ kind: 'on', channel: 9, note: 36 });
    expect(parseMidiNoteMessage([0x80, 60, 40])).toEqual({ kind: 'off', channel: 0, note: 60 });
    expect(parseMidiNoteMessage([0x91, 62, 0])).toEqual({ kind: 'off', channel: 1, note: 62 });
  });

  it('reads the sustain pedal and all-notes-off', () => {
    expect(parseMidiNoteMessage([0xb0, 64, 127])).toEqual({ kind: 'sustain', channel: 0, down: true });
    expect(parseMidiNoteMessage([0xb0, 64, 0])).toEqual({ kind: 'sustain', channel: 0, down: false });
    expect(parseMidiNoteMessage([0xb3, 123, 0])).toEqual({ kind: 'allOff', channel: 3 });
  });

  it('ignores what the studio does not play', () => {
    expect(parseMidiNoteMessage([0xb0, 7, 100])).toBeNull();
    expect(parseMidiNoteMessage([0xf8])).toBeNull();
    expect(parseMidiNoteMessage([0xe0, 0, 64])).toBeNull();
  });
});
