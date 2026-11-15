/**
 * The clock the app's live engines read, so Render to video can drive them.
 *
 * Live, `engineNowMs()` is `performance.now()`. While a render runs it is
 * the render's own time: the wall time when the render started plus the
 * show time rendered so far, so every engine that measures its step as
 * "now minus last" (modulation and LFOs, Auto, the crossfader's Auto, music
 * motion, the performance pads, clip and preset fades, stage effect
 * automation, the launch clock) moves by exactly one frame per rendered
 * frame, however long the frame took to make. When the render ends it is
 * the wall clock again (engines clamp a step that would go backwards).
 *
 * `engineRandom()` is Math.random live and a seeded generator during a
 * render, so two renders of the same show pick the same random things.
 */

let originMs: number | null = null;
let originDateMs = 0;
let startSeconds = 0;
let seconds = 0;
let seed = 0x9e3779b9;

/** A render takes the clock from show time `start`. */
export function beginRenderClock(start = 0, randomSeed = 0x9e3779b9): void {
  originMs = performance.now();
  originDateMs = Date.now();
  startSeconds = start;
  seconds = start;
  seed = randomSeed >>> 0 || 0x9e3779b9;
}

/** This frame's show time. */
export function setRenderClockSeconds(t: number): void {
  if (originMs !== null && Number.isFinite(t)) seconds = t;
}

export function endRenderClock(): void {
  originMs = null;
}

export function renderClockActive(): boolean {
  return originMs !== null;
}

/** performance.now() live; the render's time while one runs. */
export function engineNowMs(): number {
  return originMs === null ? performance.now() : originMs + (seconds - startSeconds) * 1000;
}

/** The date now; during a render, the date it started plus the time rendered (DATE in shaders). */
export function engineDate(): Date {
  return originMs === null ? new Date() : new Date(originDateMs + (seconds - startSeconds) * 1000);
}

/** Math.random live; a seeded sequence (mulberry32) while a render runs. */
export function engineRandom(): number {
  if (originMs === null) return Math.random();
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
