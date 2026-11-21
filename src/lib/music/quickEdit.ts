/**
 * The quick MIDI editor's edits, on a loop track's layers. Pure.
 */

import { clampNote, clampVelocity } from './noteEvents';
import type { RecordedNote } from './loopRecorder';
import { BEATS_PER_BAR } from './loopRecorder';
import { MAX_MIDI_LOOP_BARS, wrapBeat, type MidiLayer } from './loopTrack';

const MIN_DUR = 1 / 64;
const sort = (notes: RecordedNote[]) => notes.sort((a, b) => a.beat - b.beat || a.note - b.note);

/** Move notes `strength` (0–1) of the way to the grid; at 1 they land on it. Lengths stay. */
export function quantizeLayer(notes: MidiLayer, grid: number, strength: number, beats: number): MidiLayer {
  if (!(grid > 0)) return notes;
  const k = Math.max(0, Math.min(1, strength));
  return sort(notes.map((n) => {
    const target = Math.round(n.beat / grid) * grid;
    return { ...n, beat: wrapBeat(n.beat + (target - n.beat) * k, beats) };
  }));
}

export function transposeLayer(notes: MidiLayer, semitones: number): MidiLayer {
  return notes.map((n) => ({ ...n, note: clampNote(n.note + semitones) }));
}

/** The loop's first half (notes there kept, cut at the new end). */
export function halveLoop(layers: MidiLayer[], beats: number): { layers: MidiLayer[]; beats: number } {
  const half = beats / 2;
  if (half < BEATS_PER_BAR) return { layers, beats };
  return { beats: half, layers: layers.map((l) => l.filter((n) => n.beat < half).map((n) => ({ ...n, dur: Math.min(n.dur, half - n.beat) }))) };
}

/** Twice as long: the notes played again in the second half. */
export function doubleLoop(layers: MidiLayer[], beats: number): { layers: MidiLayer[]; beats: number } {
  if (beats * 2 > MAX_MIDI_LOOP_BARS * BEATS_PER_BAR) return { layers, beats };
  return { beats: beats * 2, layers: layers.map((l) => sort([...l, ...l.map((n) => ({ ...n, beat: n.beat + beats }))])) };
}

export function addNote(layer: MidiLayer, beat: number, note: number, dur: number, velocity: number, beats: number): MidiLayer {
  const b = wrapBeat(beat, beats);
  return sort([...layer, { beat: b, note: clampNote(note), dur: Math.max(MIN_DUR, Math.min(dur, beats - b)), velocity: clampVelocity(velocity) }]);
}

export function removeNote(layer: MidiLayer, index: number): MidiLayer {
  return layer.filter((_, i) => i !== index);
}

/** Move a note by beats and semitones (the arrow keys), wrapping in the loop. */
export function nudgeNote(layer: MidiLayer, index: number, beats: number, semitones: number, loopBeats: number): MidiLayer {
  return layer.map((n, i) => (i === index ? { ...n, beat: wrapBeat(n.beat + beats, loopBeats), note: clampNote(n.note + semitones), dur: Math.min(n.dur, loopBeats) } : n));
}

export function resizeNote(layer: MidiLayer, index: number, dur: number, loopBeats: number): MidiLayer {
  return layer.map((n, i) => (i === index ? { ...n, dur: Math.max(MIN_DUR, Math.min(dur, loopBeats - n.beat)) } : n));
}

export function setVelocity(layer: MidiLayer, index: number, velocity: number): MidiLayer {
  return layer.map((n, i) => (i === index ? { ...n, velocity: clampVelocity(velocity) } : n));
}
