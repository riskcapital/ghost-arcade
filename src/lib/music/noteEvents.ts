/**
 * Note events: the one shape every part of the music studio speaks.
 *
 * Instruments, the step sequencer, the letter keyboard, the on-screen keys,
 * MIDI devices and recorded takes all produce `NoteEvent`s. The audio engine
 * plays them, the note visuals turn them into shader inputs, and the recorder
 * stores them. Nothing listens to an input device directly.
 */

export type InstrumentId = 'synth' | 'keys' | 'drums';

export const INSTRUMENTS: readonly InstrumentId[] = ['synth', 'keys', 'drums'];

/** Index sent to shaders as `noteVoiceN`, so a shader can colour by instrument. */
export const INSTRUMENT_INDEX: Record<InstrumentId, number> = { synth: 0, keys: 1, drums: 2 };

export type DrumVoice = 'kick' | 'snare' | 'clap' | 'hatClosed' | 'hatOpen' | 'tom' | 'rim' | 'crash';

/** Kit order, as the pads and sequencer rows show it. */
export const DRUM_VOICES: readonly DrumVoice[] = ['kick', 'snare', 'clap', 'hatClosed', 'hatOpen', 'tom', 'rim', 'crash'];

/** General MIDI drum notes, so a pad controller or a drum track plays the kit. */
export const DRUM_NOTES: Record<DrumVoice, number> = {
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  hatClosed: 42,
  tom: 45,
  hatOpen: 46,
  crash: 49,
};

const GM_DRUM_ALIASES: Record<number, DrumVoice> = {
  35: 'kick', 40: 'snare', 41: 'tom', 43: 'tom', 44: 'hatClosed', 47: 'tom', 48: 'tom', 50: 'tom',
  51: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 59: 'crash',
};

export const DRUM_LABELS: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hatClosed: 'Hat',
  hatOpen: 'Open hat',
  tom: 'Tom',
  rim: 'Rim',
  crash: 'Crash',
};

/** Drum voice for a MIDI note: the GM kit, then anything else folded onto the eight pads. */
export function drumVoiceForNote(note: number): DrumVoice {
  for (const voice of DRUM_VOICES) if (DRUM_NOTES[voice] === note) return voice;
  const alias = GM_DRUM_ALIASES[note];
  if (alias) return alias;
  return DRUM_VOICES[((Math.round(note) % DRUM_VOICES.length) + DRUM_VOICES.length) % DRUM_VOICES.length];
}

export type NoteSource = 'keyboard' | 'screen' | 'midi' | 'sequencer' | 'replay';

export interface NoteEvent {
  type: 'on' | 'off';
  instrument: InstrumentId;
  /** MIDI note number, 0-127. For drums, the GM note of the voice. */
  note: number;
  /** 0-1. Note-offs carry 0. */
  velocity: number;
  /** Set for drums. */
  drum?: DrumVoice;
  source: NoteSource;
  /**
   * When the note sounds, in seconds on the music clock (the audio context's
   * clock). Live input uses "now"; the sequencer and replay schedule ahead.
   */
  time: number;
}

export function clampNote(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)));
}

export function clampVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0;
  return Math.max(0, Math.min(1, velocity));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "C4" for 60. */
export function noteName(note: number): string {
  const n = clampNote(note);
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export function isBlackKey(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
}

/** A note-on for `instrument`, filling in the drum voice. */
export function noteOn(
  instrument: InstrumentId,
  note: number,
  velocity: number,
  source: NoteSource,
  time: number,
): NoteEvent {
  const n = clampNote(note);
  return {
    type: 'on',
    instrument,
    note: n,
    velocity: clampVelocity(velocity),
    drum: instrument === 'drums' ? drumVoiceForNote(n) : undefined,
    source,
    time,
  };
}

export function noteOff(instrument: InstrumentId, note: number, source: NoteSource, time: number): NoteEvent {
  const n = clampNote(note);
  return {
    type: 'off',
    instrument,
    note: n,
    velocity: 0,
    drum: instrument === 'drums' ? drumVoiceForNote(n) : undefined,
    source,
    time,
  };
}

type NoteListener = (event: NoteEvent) => void;

/**
 * The note bus. Every producer emits here; the audio engine, note visuals
 * and recorder subscribe. Listener errors are contained so one bad consumer
 * cannot silence the others mid-performance.
 */
export function createNoteBus() {
  const listeners = new Set<NoteListener>();
  return {
    emit(event: NoteEvent): void {
      for (const listener of listeners) {
        try { listener(event); } catch (err) { console.warn('[Music] note listener failed:', err); }
      }
    },
    subscribe(listener: NoteListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const noteBus = createNoteBus();

/** Which notes are down, per instrument, counting each source separately so
 *  two keys holding one pitch release cleanly. */
export class HeldNotes {
  private held = new Map<string, number>();

  private key(instrument: InstrumentId, note: number): string {
    return `${instrument}:${note}`;
  }

  /** Returns true when this event changes what is sounding. */
  apply(event: NoteEvent): boolean {
    const k = this.key(event.instrument, event.note);
    const count = this.held.get(k) ?? 0;
    if (event.type === 'on') {
      this.held.set(k, count + 1);
      return count === 0;
    }
    if (count <= 1) {
      this.held.delete(k);
      return count === 1;
    }
    this.held.set(k, count - 1);
    return false;
  }

  isHeld(instrument: InstrumentId, note: number): boolean {
    return this.held.has(this.key(instrument, note));
  }

  notes(instrument: InstrumentId): number[] {
    const out: number[] = [];
    for (const k of this.held.keys()) {
      const [inst, note] = k.split(':');
      if (inst === instrument) out.push(Number(note));
    }
    return out.sort((a, b) => a - b);
  }

  /** Every held note, for an all-notes-off. */
  all(): Array<{ instrument: InstrumentId; note: number }> {
    return [...this.held.keys()].map((k) => {
      const [inst, note] = k.split(':');
      return { instrument: inst as InstrumentId, note: Number(note) };
    });
  }

  clear(): void {
    this.held.clear();
  }
}
