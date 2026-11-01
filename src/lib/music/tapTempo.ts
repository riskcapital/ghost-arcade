/**
 * Tap tempo for playing with a live band: tap along, and after four taps the
 * tempo is the average of the recent gaps, with stray taps (a flam, a missed
 * beat) left out. A pause of two seconds starts a fresh count. Pure, so the
 * Studio's Tap button, MIDI pads and the keyboard all share it; the tempo it
 * finds goes to the shared clock (audioStore.setManualBPM).
 */

export const TAP_RESET_MS = 2000;
export const TAP_MIN_TAPS = 4;
/** How many recent gaps the average looks at. */
const WINDOW = 8;
/** A gap this far from the median (as a fraction) is a stray tap. */
const OUTLIER = 0.25;

export interface TapState {
  taps: number[];
}

export const emptyTaps = (): TapState => ({ taps: [] });

/** Add a tap at `nowMs`; a long pause starts a new count. */
export function addTap(state: TapState, nowMs: number): TapState {
  const last = state.taps[state.taps.length - 1];
  const fresh = last === undefined || nowMs - last > TAP_RESET_MS || nowMs < last;
  const taps = fresh ? [nowMs] : [...state.taps, nowMs].slice(-(WINDOW + 1));
  return { taps };
}

/** The tempo the taps so far make, or null until there are enough of them. */
export function tapBpm(state: TapState): number | null {
  if (state.taps.length < TAP_MIN_TAPS) return null;
  const raw = state.taps.slice(1).map((t, i) => t - state.taps[i]);
  const rawMedian = [...raw].sort((a, b) => a - b)[Math.floor(raw.length / 2)];
  // A flam (a tap far too soon after the last) is dropped, so the beat it doubled stays whole.
  const keptTaps: number[] = [];
  for (const t of state.taps) if (!keptTaps.length || t - keptTaps[keptTaps.length - 1] >= rawMedian * 0.6) keptTaps.push(t);
  const gaps = keptTaps.slice(1).map((t, i) => t - keptTaps[i]);
  if (gaps.length < TAP_MIN_TAPS - 1) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = gaps.filter((g) => Math.abs(g - median) <= median * OUTLIER);
  if (!kept.length) return null;
  const avg = kept.reduce((a, b) => a + b, 0) / kept.length;
  const bpm = 60000 / avg;
  return Math.round(Math.max(30, Math.min(300, bpm)) * 10) / 10;
}

/** Half or double a tempo, kept in the clock's range. */
export function scaleTempo(bpm: number, factor: 0.5 | 2): number {
  const next = bpm * factor;
  return next < 30 || next > 300 ? bpm : Math.round(next * 10) / 10;
}

/** Ms until the next whole beat, so a new tempo comes in on the beat and loops don't jump mid-bar. */
export function msToNextBeat(beat: number, beatMs: number): number {
  const frac = beat - Math.floor(beat);
  return frac < 1e-6 ? 0 : (1 - frac) * beatMs;
}
