/**
 * Drum step pattern: one row of steps per kit voice, played on the beat grid.
 *
 * A step holds a velocity (0 = off). Scheduling is a pure function of beat
 * positions, so the sequencer can look ahead on the audio clock and a test
 * can check exactly which hits land in a window.
 */

import { gridStep, noteGrid, stepsPerBeat, swingBeat, type NoteGrid } from './grid';
import { DRUM_NOTES, DRUM_VOICES, type DrumVoice } from './noteEvents';

export const PATTERN_LENGTHS = [8, 16, 32, 64, 128, 256, 512, 1024] as const;
export type PatternLength = (typeof PATTERN_LENGTHS)[number];

/** Sixteenth-note steps. */
export const STEPS_PER_BEAT = 4;
export const DEFAULT_STEP_VELOCITY = 0.85;
export const ACCENT_STEP_VELOCITY = 1;

export interface DrumPattern {
  steps: PatternLength;
  /** Note denominator; absent in legacy sixteenth-note patterns. */
  grid?: NoteGrid;
  /** 0 (straight) to 0.5: how late every second sixteenth lands, as a share of a step. */
  swing: number;
  tracks: Record<DrumVoice, number[]>;
}

export interface ScheduledStep {
  /** Step index within the pattern. */
  step: number;
  /** Beat position the hit lands on, swing included. */
  beat: number;
  voice: DrumVoice;
  note: number;
  velocity: number;
}

export function createPattern(steps: PatternLength = 16, grid: NoteGrid = 16): DrumPattern {
  return {
    steps,
    ...(grid === 16 ? {} : { grid }),
    swing: 0,
    tracks: Object.fromEntries(DRUM_VOICES.map((v) => [v, new Array(steps).fill(0)])) as Record<DrumVoice, number[]>,
  };
}

/** A four-on-the-floor starting point, so the grid makes a beat straight away. */
export function starterPattern(): DrumPattern {
  const p = createPattern(16);
  for (let s = 0; s < 16; s += 4) p.tracks.kick[s] = ACCENT_STEP_VELOCITY;
  p.tracks.snare[4] = DEFAULT_STEP_VELOCITY;
  p.tracks.snare[12] = DEFAULT_STEP_VELOCITY;
  for (let s = 2; s < 16; s += 4) p.tracks.hatClosed[s] = 0.6;
  return p;
}

export function normalizePattern(raw: unknown): DrumPattern {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<DrumPattern>;
  const steps = (PATTERN_LENGTHS as readonly number[]).includes(Number(input.steps))
    ? (Number(input.steps) as PatternLength)
    : 16;
  const pattern = createPattern(steps, noteGrid(input.grid));
  pattern.swing = clamp(Number(input.swing) || 0, 0, 0.5);
  const tracks = (input.tracks ?? {}) as Partial<Record<DrumVoice, unknown>>;
  for (const voice of DRUM_VOICES) {
    const row = Array.isArray(tracks[voice]) ? (tracks[voice] as unknown[]) : [];
    for (let s = 0; s < steps; s++) pattern.tracks[voice][s] = clamp(Number(row[s]) || 0, 0, 1);
  }
  return pattern;
}

/** Toggle a step: off turns on at `velocity`, on turns off. Returns a new pattern. */
export function toggleStep(pattern: DrumPattern, voice: DrumVoice, step: number, velocity = DEFAULT_STEP_VELOCITY): DrumPattern {
  if (step < 0 || step >= pattern.steps) return pattern;
  const row = [...pattern.tracks[voice]];
  row[step] = row[step] > 0 ? 0 : clamp(velocity, 0.05, 1);
  return { ...pattern, tracks: { ...pattern.tracks, [voice]: row } };
}

/** Change the length, keeping the steps that still fit and repeating short patterns. */
export function resizePattern(pattern: DrumPattern, steps: PatternLength): DrumPattern {
  if (steps === pattern.steps) return pattern;
  const next = createPattern(steps, noteGrid(pattern.grid));
  next.swing = pattern.swing;
  for (const voice of DRUM_VOICES) {
    for (let s = 0; s < steps; s++) next.tracks[voice][s] = pattern.tracks[voice][s % pattern.steps] ?? 0;
  }
  return next;
}

export function clearPattern(pattern: DrumPattern): DrumPattern {
  const next = createPattern(pattern.steps, noteGrid(pattern.grid));
  next.swing = pattern.swing;
  return next;
}

/** Finer grids preserve duration, velocity and swing. Coarser grids quantize; collisions keep the louder hit. */
export function changePatternGrid(pattern: DrumPattern, grid: NoteGrid): DrumPattern {
  if (noteGrid(pattern.grid) === grid) return pattern;
  const ratio = stepsPerBeat(grid) / stepsPerBeat(pattern.grid);
  const steps = pattern.steps * ratio;
  if (!(PATTERN_LENGTHS as readonly number[]).includes(steps)) return pattern;
  const next = createPattern(steps as PatternLength, grid);
  next.swing = pattern.swing;
  for (const voice of DRUM_VOICES) {
    for (let i = 0; i < pattern.steps; i++) {
      const at = Math.round(i * ratio) % steps;
      next.tracks[voice][at] = Math.max(next.tracks[voice][at], pattern.tracks[voice][i]);
    }
  }
  return next;
}

/** Up to sixteen bars, independent of resolution. */
export function patternLengths(grid?: NoteGrid): readonly PatternLength[] {
  return PATTERN_LENGTHS.filter(n => n >= stepsPerBeat(grid) * 2 && n <= stepsPerBeat(grid) * 64);
}

/** Beat at which step `index` of loop `loop` lands, swing included. */
export function stepBeat(pattern: DrumPattern, loop: number, index: number): number {
  return swingBeat((loop * pattern.steps + index) / stepsPerBeat(pattern.grid), pattern.swing);
}

/** Length of one pass through the pattern, in beats. */
export function patternBeats(pattern: DrumPattern): number {
  return pattern.steps / stepsPerBeat(pattern.grid);
}

/**
 * Every hit whose beat falls in [fromBeat, toBeat), with the pattern looping
 * from beat 0. Hits come out in time order.
 */
export function stepsBetween(pattern: DrumPattern, fromBeat: number, toBeat: number): ScheduledStep[] {
  if (!(toBeat > fromBeat)) return [];
  const out: ScheduledStep[] = [];
  const length = patternBeats(pattern);
  // Swing moves a step at most half a step late, so no hit crosses into the
  // next loop and whole loops bound the search.
  const firstLoop = Math.floor(fromBeat / length);
  const lastLoop = Math.floor(toBeat / length);
  for (let loop = Math.max(0, firstLoop); loop <= lastLoop; loop++) {
    for (let step = 0; step < pattern.steps; step++) {
      const beat = stepBeat(pattern, loop, step);
      if (beat < fromBeat || beat >= toBeat) continue;
      for (const voice of DRUM_VOICES) {
        const velocity = pattern.tracks[voice][step];
        if (velocity > 0) out.push({ step, beat, voice, note: DRUM_NOTES[voice], velocity });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** Which step is playing at `beat`, for the playhead. */
export function stepAt(pattern: DrumPattern, beat: number): number {
  if (!(beat >= 0)) return 0;
  return gridStep(beat, pattern.grid, pattern.swing) % pattern.steps;
}

export function patternHasHits(pattern: DrumPattern): boolean {
  return DRUM_VOICES.some((v) => pattern.tracks[v].some((s) => s > 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
