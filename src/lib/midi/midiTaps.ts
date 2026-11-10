/**
 * Listeners that see controller messages before the mappings do (the
 * Timeline's line bindings and "touch a knob to bind"). MIDI learn, edit
 * and identify mode come first and are never seen here.
 */
import type { MidiMessageType } from './midiTypes';

/** Return true to keep the message from the mappings (it was used to bind). */
export type MidiTap = (channel: number, type: MidiMessageType, number: number, value: number, from: { id: string | null; name?: string }) => boolean;

const taps = new Set<MidiTap>();

export function addMidiTap(tap: MidiTap): () => void {
  taps.add(tap);
  return () => { taps.delete(tap); };
}

export function runMidiTaps(channel: number, type: MidiMessageType, number: number, value: number, from: { id: string | null; name?: string }): boolean {
  let consumed = false;
  for (const tap of taps) {
    try {
      if (tap(channel, type, number, value, from)) consumed = true;
    } catch (err) {
      console.warn('[MIDI] tap failed:', err);
    }
  }
  return consumed;
}
