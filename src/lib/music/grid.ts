/** Musical grid denominators. A beat is a quarter note; old projects use 1/16. */
export const NOTE_GRIDS = [16, 32, 64] as const;
export type NoteGrid = (typeof NOTE_GRIDS)[number];
export function noteGrid(value: unknown): NoteGrid {
  return NOTE_GRIDS.includes(Number(value) as NoteGrid) ? Number(value) as NoteGrid : 16;
}
export function stepsPerBeat(value?: unknown): number { return noteGrid(value) / 4; }

/** Swing stretches the first sixteenth of each eighth, preserving its feel at finer grids. */
export function swingBeat(beat: number, swing: number): number {
  const pair = Math.floor(beat * 2) / 2;
  const x = beat - pair;
  return pair + (x <= 0.25 ? x * (1 + swing) : 0.25 * (1 + swing) + (x - 0.25) * (1 - swing));
}
export function unswingBeat(beat: number, swing: number): number {
  const pair = Math.floor(beat * 2) / 2;
  const x = beat - pair;
  const split = 0.25 * (1 + swing);
  return pair + (x <= split ? x / (1 + swing) : 0.25 + (x - split) / (1 - swing));
}
export function gridStep(beat: number, grid: unknown, swing = 0): number {
  return Math.floor(unswingBeat(beat, swing) * stepsPerBeat(grid) + 1e-9);
}
/** Nearest audible step, including swing. */
export function nearestGridStep(beat: number, grid: unknown, swing = 0): number {
  const lower = gridStep(beat, grid, swing);
  const rate = stepsPerBeat(grid);
  return beat - swingBeat(lower / rate, swing) <= swingBeat((lower + 1) / rate, swing) - beat ? lower : lower + 1;
}
/** Independent of editor resolution, so adjacent fine hits never share a live-recording key. */
export function beatTick(beat: number): number { return Math.round(beat * 960); }
export function gridForBeats(beats: readonly number[]): NoteGrid {
  return NOTE_GRIDS.find(g => beats.every(b => Math.abs(b * stepsPerBeat(g) - Math.round(b * stepsPerBeat(g))) < 1e-6)) ?? 64;
}
