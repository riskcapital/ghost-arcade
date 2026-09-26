/**
 * SMPTE timecode arithmetic shared by the LTC decoder, the MTC parser and
 * the chase store.
 *
 * Rates are the four SMPTE ones a show is ever fed: 24, 25, 29.97 and 30.
 * 29.97 is almost always drop-frame; 29.97 non-drop exists (and LTC can carry
 * it) so it is representable, but the MTC wire format has no code for it.
 *
 * Drop-frame skips frame numbers 00 and 01 at the start of every minute
 * except minutes divisible by ten, which keeps the displayed clock within a
 * frame of wall time over an hour. Seconds are derived from the running
 * frame count, never from HH:MM:SS directly, so a DF label converts to the
 * real elapsed time of the programme.
 */

export type TimecodeRate = 24 | 25 | 29.97 | 30;

export const TIMECODE_RATES: TimecodeRate[] = [24, 25, 29.97, 30];

export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  rate: TimecodeRate;
  dropFrame: boolean;
}

/** Frames per labelled second: 30 for both 29.97 and 30. */
export function nominalFps(rate: TimecodeRate): number {
  return rate === 29.97 ? 30 : rate;
}

/** Real frames per second of wall time. */
export function actualFps(rate: TimecodeRate): number {
  return rate === 29.97 ? 30000 / 1001 : rate;
}

export function isTimecodeRate(value: unknown): value is TimecodeRate {
  return value === 24 || value === 25 || value === 29.97 || value === 30;
}

/** Running frame count since 00:00:00:00 for a label. */
export function timecodeToFrameNumber(tc: Timecode): number {
  const fps = nominalFps(tc.rate);
  const base = ((tc.hours * 60 + tc.minutes) * 60 + tc.seconds) * fps + tc.frames;
  if (!tc.dropFrame || fps !== 30) return base;
  const totalMinutes = tc.hours * 60 + tc.minutes;
  return base - 2 * (totalMinutes - Math.floor(totalMinutes / 10));
}

/** Inverse of timecodeToFrameNumber. Wraps at 24 hours. */
export function frameNumberToTimecode(frameNumber: number, rate: TimecodeRate, dropFrame: boolean): Timecode {
  const fps = nominalFps(rate);
  const df = dropFrame && fps === 30;
  const perDay = df ? 17982 * 6 * 24 : fps * 86400;
  let n = Math.floor(frameNumber) % perDay;
  if (n < 0) n += perDay;
  if (df) {
    const tens = Math.floor(n / 17982);
    const rem = n % 17982;
    n += 18 * tens + (rem > 1 ? 2 * Math.floor((rem - 2) / 1798) : 0);
  }
  const frames = n % fps;
  const totalSeconds = Math.floor(n / fps);
  return {
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    frames,
    rate,
    dropFrame: df,
  };
}

/** Wall-clock seconds at the START of the labelled frame. */
export function timecodeToSeconds(tc: Timecode): number {
  return timecodeToFrameNumber(tc) / actualFps(tc.rate);
}

/** Label of the frame that contains `seconds`. */
export function secondsToTimecode(seconds: number, rate: TimecodeRate, dropFrame = rate === 29.97): Timecode {
  const n = Math.floor(Math.max(0, seconds) * actualFps(rate) + 1e-6);
  return frameNumberToTimecode(n, rate, dropFrame);
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** HH:MM:SS:FF, with the conventional ';' before the frames for drop-frame. */
export function formatTimecode(tc: Timecode): string {
  return `${pad2(tc.hours)}:${pad2(tc.minutes)}:${pad2(tc.seconds)}${tc.dropFrame ? ';' : ':'}${pad2(tc.frames)}`;
}

/** Format a seconds value (which may be negative) as a signed timecode. */
export function formatSecondsAsTimecode(seconds: number, rate: TimecodeRate, dropFrame = rate === 29.97): string {
  const sign = seconds < 0 ? '-' : '';
  return sign + formatTimecode(secondsToTimecode(Math.abs(seconds), rate, dropFrame));
}

/**
 * Parse "HH:MM:SS:FF" (or ';' / '.' separators, or fewer fields read from
 * the right: "SS:FF", "MM:SS:FF") into seconds. A leading '-' negates.
 * Returns null for anything that is not a valid label at `rate`.
 */
export function parseTimecodeToSeconds(text: string, rate: TimecodeRate, dropFrame = rate === 29.97): number | null {
  const raw = text.trim();
  if (!raw) return null;
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  const parts = body.split(/[:;.]/).map((p) => p.trim());
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  while (nums.length < 4) nums.unshift(0);
  const [hours, minutes, seconds, frames] = nums;
  if (minutes > 59 || seconds > 59 || hours > 23 || frames >= nominalFps(rate)) return null;
  const df = dropFrame && nominalFps(rate) === 30;
  if (df && frames < 2 && seconds === 0 && minutes % 10 !== 0) return null;
  const value = timecodeToSeconds({ hours, minutes, seconds, frames, rate, dropFrame: df });
  return negative ? -value : value;
}

/** Label for a rate in menus. */
export function rateLabel(rate: TimecodeRate, dropFrame = rate === 29.97): string {
  if (rate === 29.97) return dropFrame ? '29.97 drop-frame' : '29.97 non-drop';
  return `${rate} fps`;
}
