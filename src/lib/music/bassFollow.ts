/**
 * The drone following the band's bass player.
 *
 * Bass notes come in (from an input playing the bass, or a MIDI bass); the
 * drone moves only once a note has stayed the newest for a moment, so
 * passing notes, fast runs and a wrong pitch at the attack never shake it.
 * Pitch classes are compared, so a note heard an octave off still counts.
 *
 * The drone's chords keep the studio's key and scale: they are moved along
 * the scale so their root sits on the bass's note (or the scale note
 * nearest it). Pure: the caller owns the clock and plays the notes.
 */

import { SCALES, snapToScale, type MusicKey } from './studioSets';

/** How long the bass must stay on a note before the drone moves to it. */
export const BASS_STABLE_SECONDS = 0.15;

const pitchClass = (note: number) => ((Math.round(note) % 12) + 12) % 12;

export class BassFollower {
  private candidate: { pc: number; since: number } | null = null;
  /** The pitch class the drone is rooted on, or null before the bass is heard. */
  root: number | null = null;

  /** A bass note started (or slid to a new pitch) at `time` seconds. */
  hear(note: number, time: number): void {
    const pc = pitchClass(note);
    // The same note again (a repeated note, a retrigger) keeps its time.
    if (this.candidate?.pc === pc) return;
    // Back to the note the drone is on before the new one settled: nothing moves.
    this.candidate = pc === this.root ? null : { pc, since: time };
  }

  /** Seconds from `time` until the waiting note settles, or null with nothing waiting. */
  wait(time: number): number | null {
    return this.candidate ? Math.max(0, this.candidate.since + BASS_STABLE_SECONDS - time) : null;
  }

  /** The new root once the waiting note has held long enough, else null. */
  settle(time: number): number | null {
    if (!this.candidate || time - this.candidate.since < BASS_STABLE_SECONDS - 1e-6) return null;
    this.root = this.candidate.pc;
    this.candidate = null;
    return this.root;
  }

  reset(): void {
    this.candidate = null;
    this.root = null;
  }
}

/**
 * Scale degrees to move the drone's chords by, so a chord on the key's root
 * lands on `root` (a pitch class; null for the key's own root). The move is
 * at most half the scale either way, so the drone stays in its register.
 */
export function droneShift(key: MusicKey, root: number | null): number {
  if (root === null) return 0;
  const steps = SCALES[key.scale].steps;
  const snapped = snapToScale(60 + pitchClass(root), key);
  const degree = steps.indexOf(pitchClass(snapped - key.root));
  if (degree < 0) return 0;
  return degree <= Math.floor(steps.length / 2) ? degree : degree - steps.length;
}
