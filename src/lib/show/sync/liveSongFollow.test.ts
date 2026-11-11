/**
 * Following Live's arrangement position: the script's reports anchor the
 * chase; with Link, the position runs on Link's clock between reports and a
 * jump in Live is taken at once. Also the `show:phrase` control paths.
 */
import { describe, expect, it } from 'vitest';
import { LiveSongFollower, LIVE_JUMP_QUARTERS } from './liveSongFollow';
import { showSecondsForSourceQuarters } from './beatChase';
import { createTempoMap } from '../tempoMap';
import { parseShowControlPath } from '../../control/showControlPaths';
import { validateControlPath } from '../../control/controlPaths';

const report = (beat: number, atMs: number, playing = true, tempo = 120) => ({ beat, atMs, playing, tempo });

describe("following Live's song position", () => {
  it('without Link: each report is an anchor; a stopped Live parks once per new position', () => {
    const f = new LiveSongFollower();
    expect(f.report(report(16, 1000), null)).toEqual({ quarters: 16, atMs: 1000, running: true, bpm: 120 });
    expect(f.report(report(16, 1000), null)).toBeNull();
    expect(f.report(report(16.2, 1100), null)?.quarters).toBe(16.2);
    expect(f.poll(1150, null)).toBeNull();
    expect(f.report(report(20, 2000, false), null)).toEqual({ quarters: 20, atMs: 2000, running: false, bpm: 120 });
    expect(f.report(report(20, 3000, false), null)).toBeNull();
    expect(f.report(report(24, 4000, false), null)?.quarters).toBe(24);
  });

  it("with Link: settles on Live's offset to Link and runs on Link's clock; jittery reports do not move it", () => {
    const f = new LiveSongFollower();
    // Live is 32 beats ahead of the Link session; reports jitter ±0.02 beats.
    const link = (ms: number) => (ms / 1000) * 2;
    const jitter = [0.02, -0.01, 0.015, -0.02, 0.0];
    jitter.forEach((j, i) => f.report(report(link(1000 + i * 100) + 32 + j, 1000 + i * 100), link(1000 + i * 100)));
    expect(f.linkOffset).toBeCloseTo(32, 1);
    const p = f.poll(1550, link(1550))!;
    expect(p.running).toBe(true);
    expect(p.quarters).toBeCloseTo(link(1550) + 32, 1);
    // A locator jump in Live: 16 beats on. Taken from the first report after.
    const jumped = f.report(report(link(1600) + 48, 1600), link(1600))!;
    expect(jumped.quarters).toBeCloseTo(link(1600) + 48, 6);
    expect(f.linkOffset).toBeNull();
    f.report(report(link(1700) + 48, 1700), link(1700));
    f.report(report(link(1800) + 48, 1800), link(1800));
    expect(f.poll(1850, link(1850))!.quarters).toBeCloseTo(link(1850) + 48, 6);
    expect(LIVE_JUMP_QUARTERS).toBeLessThan(1);
  });

  it('the song position lands on the show bar the bar offset says', () => {
    const map = createTempoMap(120, 0);
    // Live's bar 1 on show bar 1: beat 16 (bar 5) = 8 s.
    expect(showSecondsForSourceQuarters(map, 16, 0)).toBeCloseTo(8, 6);
    // Live's bar 1 on show bar 3: beat 16 = 12 s.
    expect(showSecondsForSourceQuarters(map, 16, 2)).toBeCloseTo(12, 6);
  });
});

describe('phrase control paths', () => {
  it('show:phrase:<n> launches pad n, show:phrase:stop stops; anything else is not a phrase path', () => {
    expect(parseShowControlPath(['show', 'phrase', '1'])).toEqual({ phrase: 0 });
    expect(parseShowControlPath(['show', 'phrase', '12'])).toEqual({ phrase: 11 });
    expect(parseShowControlPath(['show', 'phrase', 'stop'])).toEqual({ phrase: null });
    expect(parseShowControlPath(['show', 'phrase', '0'])).toBeNull();
    expect(parseShowControlPath(['show', 'phrase'])).toBeNull();
    expect(validateControlPath('show:phrase:3').valid).toBe(true);
    expect(validateControlPath('show:phrase:x').valid).toBe(false);
  });
});
