/**
 * The band's MIDI keyboard (or pads) as an input of its own.
 *
 * Its notes go to the visual voices as one sound (the chords, unless the
 * input is set to another), and as real pitches they tell the band's key.
 * Channel 10 is the drum channel: kicks, snares, hats and the rest go to
 * their own sounds, and a kick dips the studio under it. An input can also
 * play a studio instrument (the one picked in the studio, or its own).
 *
 * The input's settings live with the input (Settings > MIDI, midiInputs.ts).
 * Notes are let go of by the input they came from, so changing its settings
 * mid-note or unplugging it never leaves a note hanging.
 */

import type { MidiInputSetup } from '../midi/midiTypes';
import { DRUM_CHANNEL, parseMidiNoteMessage, type MidiNoteMessage } from './midiNotes';
import { PLAYABLE_INSTRUMENTS, type InstrumentId } from './noteEvents';
import { VOICE_SOURCES, type VoiceSourceId } from './visualVoices';

/** What the band's keys count as for the visuals when nothing else is chosen. */
export const BAND_KEYS_DEFAULT_ROLE: VoiceSourceId = 'chords';

/** The drum sound a General MIDI drum note belongs to. */
export function drumRoleForNote(note: number): VoiceSourceId {
  if (note === 35 || note === 36) return 'kick';
  // 37 side stick and 39 clap count with the snare, as they do in the studio's kit.
  if (note >= 37 && note <= 40) return 'snare';
  if (note === 42 || note === 44 || note === 46) return 'hats';
  return 'perc';
}

/** The sound an input's notes count as. */
export function bandKeysRole(setup: Pick<MidiInputSetup, 'role'>): VoiceSourceId {
  return VOICE_SOURCES.some((s) => s.id === setup.role) ? (setup.role as VoiceSourceId) : BAND_KEYS_DEFAULT_ROLE;
}

/** The instrument an input plays: its own, or the one picked in the studio. Drums on channel 10. */
export function bandKeysInstrument(setup: Pick<MidiInputSetup, 'instrument'>, channel: number, picked: InstrumentId): InstrumentId {
  if (channel === DRUM_CHANNEL) return 'drums';
  const own = setup.instrument as InstrumentId | undefined;
  return own && PLAYABLE_INSTRUMENTS.includes(own) ? own : picked;
}

export interface BandKeysOut {
  /** A note for the visual voices. `pitched`: a real pitch, which tells the band's key. */
  visual(type: 'on' | 'off', note: number, velocity: number, role: VoiceSourceId, pitched: boolean): void;
  play(instrument: InstrumentId, note: number, velocity: number): void;
  release(instrument: InstrumentId, note: number): void;
  /** The instrument picked in the studio. */
  picked(): InstrumentId;
  /** Whether the studio can play now (it is open). */
  canPlay(): boolean;
  /** A kick from the band (the studio dips under it). */
  kick?(velocity: number): void;
  /** A bass note from the band. */
  bass?(note: number, velocity: number): void;
}

interface Sounding {
  note: number;
  role: VoiceSourceId;
  /** The studio instrument it plays, if any. */
  instrument: InstrumentId | null;
  /** The key is still down (the pedal may be holding it otherwise). */
  down: boolean;
}

interface InputState {
  notes: Map<number, Sounding>;
  sustain: boolean;
}

export class BandKeys {
  private inputs = new Map<string, InputState>();

  constructor(private out: BandKeysOut) {}

  /** A raw message from a band keys input. */
  message(data: ArrayLike<number>, setup: MidiInputSetup): void {
    const message = parseMidiNoteMessage(data);
    if (message) this.handle(message, setup);
  }

  handle(message: MidiNoteMessage, setup: MidiInputSetup): void {
    const input = this.inputs.get(setup.name) ?? { notes: new Map(), sustain: false };
    this.inputs.set(setup.name, input);
    if (message.kind === 'sustain') {
      input.sustain = message.down;
      if (!input.sustain) {
        for (const [key, n] of [...input.notes]) if (!n.down) this.letGo(input, key);
      }
      return;
    }
    if (message.kind === 'allOff') {
      this.release(setup.name);
      return;
    }
    const key = message.channel * 128 + message.note;
    if (message.kind === 'off') {
      const n = input.notes.get(key);
      if (!n) return;
      if (input.sustain) n.down = false;
      else this.letGo(input, key);
      return;
    }
    // A key struck again while still sounding starts afresh.
    if (input.notes.has(key)) this.letGo(input, key);
    const drum = message.channel === DRUM_CHANNEL;
    const role = drum ? drumRoleForNote(message.note) : bandKeysRole(setup);
    const v = message.velocity;
    this.out.visual('on', message.note, v, role, !drum);
    if (role === 'kick') this.out.kick?.(v);
    else if (role === 'bass') this.out.bass?.(message.note, v);
    let instrument: InstrumentId | null = null;
    if (setup.play && this.out.canPlay()) {
      instrument = bandKeysInstrument(setup, message.channel, this.out.picked());
      this.out.play(instrument, message.note, v);
    }
    // A drum hit decays by itself (the kit too): nothing to let go of.
    if (drum) return;
    input.notes.set(key, { note: message.note, role, instrument, down: true });
  }

  /** Let go of everything one input holds (it was unplugged or set up again). */
  release(name: string): void {
    const input = this.inputs.get(name);
    if (!input) return;
    for (const key of [...input.notes.keys()]) this.letGo(input, key);
    this.inputs.delete(name);
  }

  releaseAll(): void {
    for (const name of [...this.inputs.keys()]) this.release(name);
  }

  /** Notes sounding now, for tests. */
  soundingCount(): number {
    let n = 0;
    for (const input of this.inputs.values()) n += input.notes.size;
    return n;
  }

  private letGo(input: InputState, key: number): void {
    const n = input.notes.get(key);
    if (!n) return;
    input.notes.delete(key);
    this.out.visual('off', n.note, 0, n.role, true);
    if (n.instrument) this.out.release(n.instrument, n.note);
  }
}
