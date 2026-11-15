/**
 * Frame rates for Render to video, as exact fractions.
 *
 * The NTSC rates (23.976, 29.97, 59.94) are really 24000/1001, 30000/1001
 * and 60000/1001. A render keeps the rate as a plain number (the store and
 * the settings stay simple) and every place that needs it exactly turns it
 * back into the fraction here: frame i is at i * den / num seconds, and the
 * encoder is told "30000/1001", never "29.97" (which would drift by 0.1 s an
 * hour against the sound).
 */

export interface RenderRate {
  /** What the render settings hold. */
  fps: number;
  label: string;
}

export const RENDER_RATES: readonly RenderRate[] = [
  { fps: 24000 / 1001, label: '23.976 fps' },
  { fps: 24, label: '24 fps' },
  { fps: 25, label: '25 fps' },
  { fps: 30000 / 1001, label: '29.97 fps' },
  { fps: 30, label: '30 fps' },
  { fps: 50, label: '50 fps' },
  { fps: 60000 / 1001, label: '59.94 fps' },
  { fps: 60, label: '60 fps' },
  { fps: 120, label: '120 fps' },
];

/** The rate as num/den: whole rates over 1, the NTSC rates over 1001. */
export function rateFraction(fps: number): { num: number; den: number } {
  if (!Number.isFinite(fps) || fps <= 0) return { num: 30, den: 1 };
  const whole = Math.round(fps);
  if (Math.abs(fps - whole) < 1e-9) return { num: whole, den: 1 };
  const ntsc = Math.round((fps * 1001) / 1000);
  if (Math.abs(fps - (ntsc * 1000) / 1001) < 1e-6) return { num: ntsc * 1000, den: 1001 };
  // Anything else: to the millihertz, which is all a rate field can hold.
  return { num: Math.round(fps * 1000), den: 1000 };
}

/** The rate as ffmpeg reads it ("30", "30000/1001"). */
export function ffmpegRate(fps: number): string {
  const { num, den } = rateFraction(fps);
  return den === 1 ? String(num) : `${num}/${den}`;
}

/** Show time of frame `index`, from `start`: exact for every rate above (no running sum). */
export function frameTime(index: number, fps: number, start = 0): number {
  const { num, den } = rateFraction(fps);
  return start + (index * den) / num;
}

/** Frames in `seconds` (at least one). */
export function frameCount(seconds: number, fps: number): number {
  const { num, den } = rateFraction(fps);
  return Math.max(1, Math.round((Math.max(0, seconds) * num) / den));
}

/** The length of `frames` frames, seconds: what the sound is cut to. */
export function framesDuration(frames: number, fps: number): number {
  const { num, den } = rateFraction(fps);
  return (frames * den) / num;
}

/** The closest preset to `fps` (a saved or typed rate shown in the list). */
export function nearestRate(fps: number): RenderRate {
  return RENDER_RATES.reduce((best, r) => (Math.abs(r.fps - fps) < Math.abs(best.fps - fps) ? r : best), RENDER_RATES[4]);
}

/**
 * The audio analysis behind reactive content steps at this fixed rate in a
 * render, whatever the video rate: its smoothing and beat detectors work per
 * analysis, so analysing once per video frame would make a 120 fps render
 * react twice as fast as a 30 fps one. 60 a second is what a 60 Hz screen
 * runs it at live.
 */
export const ANALYSIS_RATE = 60;

/**
 * Analysis instants that are due by show time `t`, given the next one due
 * (`next`): returns them and the next one after. Step k is at
 * `origin + k / ANALYSIS_RATE`, computed from k (no running sum).
 */
export function analysisStepsUpTo(origin: number, nextStep: number, t: number): { times: number[]; nextStep: number } {
  const times: number[] = [];
  let k = nextStep;
  // A frame never needs more than a second of catching up (a 1 fps render).
  while (origin + k / ANALYSIS_RATE <= t + 1e-9 && times.length < ANALYSIS_RATE) {
    times.push(origin + k / ANALYSIS_RATE);
    k++;
  }
  return { times, nextStep: k };
}
