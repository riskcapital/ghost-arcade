import { describe, expect, it } from 'vitest';
import {
  formatTimecode,
  frameNumberToTimecode,
  parseTimecodeToSeconds,
  secondsToTimecode,
  timecodeToFrameNumber,
  timecodeToSeconds,
  type TimecodeRate,
} from './timecode';

describe('timecode arithmetic', () => {
  it('round-trips every frame number of a day at every rate', () => {
    for (const rate of [24, 25, 29.97, 30] as TimecodeRate[]) {
      const df = rate === 29.97;
      const perDay = df ? 2589408 : (rate === 29.97 ? 30 : rate) * 86400;
      for (let n = 0; n < perDay; n += 773) {
        expect(timecodeToFrameNumber(frameNumberToTimecode(n, rate, df))).toBe(n);
      }
    }
  });

  it('drops 00 and 01 at each minute except every tenth', () => {
    const at = (n: number) => formatTimecode(frameNumberToTimecode(n, 29.97, true));
    expect(at(1799)).toBe('00:00:59;29');
    expect(at(1800)).toBe('00:01:00;02');
    expect(at(17981)).toBe('00:09:59;29');
    expect(at(17982)).toBe('00:10:00;00');
    expect(at(17983)).toBe('00:10:00;01');
    // One hour of DF is 107892 frames, one frame short of 3600 s * 29.97.
    expect(timecodeToFrameNumber({ hours: 1, minutes: 0, seconds: 0, frames: 0, rate: 29.97, dropFrame: true })).toBe(107892);
  });

  it('converts DF labels to real elapsed seconds', () => {
    const hour = timecodeToSeconds({ hours: 1, minutes: 0, seconds: 0, frames: 0, rate: 29.97, dropFrame: true });
    expect(hour).toBeCloseTo(3599.9964, 3);
    expect(formatTimecode(secondsToTimecode(3600, 29.97))).toBe('01:00:00;00');
    expect(formatTimecode(secondsToTimecode(90.5, 25))).toBe('00:01:30:12');
  });

  it('parses labels and rejects invalid ones', () => {
    expect(parseTimecodeToSeconds('01:00:00:00', 25)).toBe(3600);
    expect(parseTimecodeToSeconds('-00:00:01:00', 30)).toBe(-1);
    expect(parseTimecodeToSeconds('10:12', 25)).toBeCloseTo(10.48, 9);
    expect(parseTimecodeToSeconds('00:00:00:25', 25)).toBeNull();
    expect(parseTimecodeToSeconds('00:01:00;00', 29.97)).toBeNull();
    expect(parseTimecodeToSeconds('00:10:00;00', 29.97)).toBeCloseTo((17982 * 1001) / 30000, 9);
    expect(parseTimecodeToSeconds('abc', 30)).toBeNull();
  });
});
