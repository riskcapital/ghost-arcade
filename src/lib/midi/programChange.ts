/**
 * Program Change messages from the control inputs, for whoever listens
 * (the live looper's pedal track select). The MIDI manager hands them here;
 * nothing else in the app maps Program Change.
 */

type Listener = (channel: number, program: number) => void;
const listeners = new Set<Listener>();

export function onProgramChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitProgramChange(channel: number, program: number): void {
  for (const l of listeners) {
    try {
      l(channel & 0x0f, program & 0x7f);
    } catch (err) {
      console.warn('[MIDI] program change listener failed:', err);
    }
  }
}
