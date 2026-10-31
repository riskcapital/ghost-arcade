/**
 * MIDI keyboards and pads as studio instruments.
 *
 * Listens to every connected MIDI input (or one chosen input) for notes, the
 * sustain pedal and all-notes-off, alongside the app's MIDI control mapping:
 * it adds its own listener to each input instead of taking over the input's
 * message handler, so mappings, MIDI learn and clock-in keep working.
 * Devices plugged in or out while the studio is open are picked up straight
 * away. Inputs set up as the band's keys are left to bandKeys.ts, which
 * plays them with their own settings.
 */

import { get, writable } from 'svelte/store';
import { midiStore } from '../midi/midiStore';
import { mappingHearsDevice, midiInputsInUse, type MidiInputsInUse } from '../midi/midiInputs';

export interface MusicMidiDevice {
  id: string;
  name: string;
}

export type MidiNoteMessage =
  | { kind: 'on'; channel: number; note: number; velocity: number }
  | { kind: 'off'; channel: number; note: number }
  | { kind: 'sustain'; channel: number; down: boolean }
  | { kind: 'allOff'; channel: number };

/** Read a raw MIDI message. Anything the studio does not play returns null. */
export function parseMidiNoteMessage(data: ArrayLike<number>): MidiNoteMessage | null {
  if (!data || data.length < 2) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1] & 0x7f;
  const d2 = data.length > 2 ? data[2] & 0x7f : 0;
  if (status === 0x90) {
    // A note-on with velocity 0 is a note-off (running status keyboards send these).
    return d2 > 0 ? { kind: 'on', channel, note: d1, velocity: d2 / 127 } : { kind: 'off', channel, note: d1 };
  }
  if (status === 0x80) return { kind: 'off', channel, note: d1 };
  if (status === 0xb0) {
    if (d1 === 64) return { kind: 'sustain', channel, down: d2 >= 64 };
    if (d1 === 120 || d1 === 123) return { kind: 'allOff', channel };
  }
  return null;
}

/** MIDI channel 10 (index 9) is the drum channel by convention. */
export const DRUM_CHANNEL = 9;

/** Connected inputs, for the studio's input picker. */
export const musicMidiDevices = writable<MusicMidiDevice[]>([]);
export const musicMidiStatus = writable<'off' | 'waiting' | 'ready' | 'unavailable'>('off');

type Listener = (message: MidiNoteMessage, inputId: string) => void;

type MidiAccessLike = MIDIAccess;

/**
 * True when the app's MIDI mapping already uses this note from this input
 * (a pad mapped to launch a clip, say) or MIDI learn is listening: then the
 * studio leaves the note alone so one press does not do two things.
 */
function claimedByControlMapping(input: { id: string; name?: string | null }, message: MidiNoteMessage, inUse: MidiInputsInUse): boolean {
  if (message.kind !== 'on' && message.kind !== 'off') return false;
  const midi = get(midiStore);
  if (midi.learn.active || midi.editMode || midi.identifyMode) return true;
  if (inUse.control.length && !inUse.control.includes(input.id)) return false;
  return midi.mappings.some(
    (m) => m.type === 'note' && m.number === message.note && (m.channel === -1 || m.channel === message.channel)
      && mappingHearsDevice(m, input.name ?? undefined, inUse.controlNames),
  );
}

export class MusicMidiInput {
  private access: MidiAccessLike | null = null;
  private attached = new Map<string, MIDIInput>();
  private selected = '';
  private running = false;
  private inUse: MidiInputsInUse = get(midiInputsInUse);
  private unsubscribeInUse: (() => void) | null = null;
  private readonly onMessage = (event: Event) => {
    const e = event as MIDIMessageEvent;
    const input = e.target as MIDIInput | null;
    if (!input || !e.data) return;
    if (this.selected && input.id !== this.selected) return;
    // The band's keys play with their own settings (bandKeys.ts).
    if (this.inUse.keys.includes(input.id)) return;
    const message = parseMidiNoteMessage(e.data);
    if (!message || claimedByControlMapping(input, message, this.inUse)) return;
    this.listener(message, input.id);
  };
  private readonly onStateChange = () => this.refresh();

  constructor(private listener: Listener) {}

  /** Choose one input by id, or '' for all of them. */
  select(inputId: string): void {
    this.selected = inputId;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.unsubscribeInUse ??= midiInputsInUse.subscribe((inUse) => (this.inUse = inUse));
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      musicMidiStatus.set('unavailable');
      return;
    }
    musicMidiStatus.set('waiting');
    try {
      // The app asks for MIDI at launch; once granted, asking again resolves
      // straight away with the same permission.
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (!this.running) return;
      this.access = access;
      access.addEventListener('statechange', this.onStateChange);
      this.refresh();
      musicMidiStatus.set('ready');
    } catch (err) {
      console.warn('[Music] MIDI unavailable:', err);
      musicMidiStatus.set('unavailable');
    }
  }

  stop(): void {
    this.running = false;
    this.unsubscribeInUse?.();
    this.unsubscribeInUse = null;
    for (const input of this.attached.values()) input.removeEventListener('midimessage', this.onMessage);
    this.attached.clear();
    this.access?.removeEventListener('statechange', this.onStateChange);
    this.access = null;
    musicMidiDevices.set([]);
    musicMidiStatus.set('off');
  }

  /** Attach to inputs that appeared, drop ones that went away. */
  private refresh(): void {
    if (!this.access) return;
    const live = new Map<string, MIDIInput>();
    this.access.inputs.forEach((input) => {
      if (input.state === 'connected') live.set(input.id, input);
    });
    for (const [id, input] of this.attached) {
      if (!live.has(id)) {
        input.removeEventListener('midimessage', this.onMessage);
        this.attached.delete(id);
      }
    }
    for (const [id, input] of live) {
      if (this.attached.has(id)) continue;
      input.addEventListener('midimessage', this.onMessage);
      // addEventListener does not open the port the way onmidimessage does.
      input.open?.().catch(() => {});
      this.attached.set(id, input);
    }
    musicMidiDevices.set([...live.values()].map((i) => ({ id: i.id, name: i.name || 'MIDI input' })));
  }
}
