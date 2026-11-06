import { describe, expect, it } from 'vitest';
import {
  attackRelease,
  drivenParamValue,
  freshSmoothSignals,
  musicMotionParams,
  musicTimePhase,
  musicTimeRate,
  MAX_TIME_RATE,
  MIN_TIME_RATE,
  MUSIC_TIME_PHASE_INPUT,
  MUSIC_TIME_RATE_INPUT,
  normalizeMusicMotion,
  pickMusicMotionParams,
  smoothSignals,
  stepMusicClock,
  surge,
  withMusicTime,
  type MusicClock,
} from './musicMotion';
import type { ISFInputDef } from '../types';

const DT = 1 / 60;

/** Play `seconds` of music: a level (with a hit each beat at 120 BPM when `beats`). Returns the clock and the signals. */
function play(clock: MusicClock, s: ReturnType<typeof freshSmoothSignals>, seconds: number, level: number, beats = true, amount = 1) {
  const rates: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (beats && i % 30 === 0) surge(s, 0.9);
    smoothSignals(s, level, DT);
    stepMusicClock(clock, musicTimeRate(s, amount, true), DT);
    rates.push(clock.rate);
  }
  return rates;
}

describe('music clock', () => {
  it('runs at about normal speed while the music plays at its usual level, whatever the input gain', () => {
    for (const level of [0.08, 0.3, 0.9]) {
      const s = freshSmoothSignals();
      const clock = { offset: 0, rate: 1 };
      const rates = play(clock, s, 20, level);
      const last = rates.slice(-120);
      const mean = last.reduce((a, b) => a + b, 0) / last.length;
      expect(mean, `level ${level}`).toBeGreaterThan(0.85);
      expect(mean, `level ${level}`).toBeLessThan(1.25);
    }
  });

  it('speeds up when the music gets louder and busier, and eases down when it gets quiet', () => {
    const s = freshSmoothSignals();
    const clock = { offset: 0, rate: 1 };
    play(clock, s, 15, 0.3);
    const lift = play(clock, s, 2, 0.9);
    expect(Math.max(...lift)).toBeGreaterThan(1.4);
    expect(Math.max(...lift)).toBeLessThanOrEqual(MAX_TIME_RATE);
    play(clock, s, 15, 0.3);
    const drop = play(clock, s, 2, 0.05, false);
    expect(Math.min(...drop)).toBeLessThan(0.8);
    expect(Math.min(...drop)).toBeGreaterThanOrEqual(MIN_TIME_RATE);
  });

  it('never crawls, never stops, never jumps', () => {
    const s = freshSmoothSignals();
    const clock = { offset: 0, rate: 1 };
    let prevRate = clock.rate;
    for (let i = 0; i < 1200; i++) {
      const level = i % 240 < 60 ? 1 : 0.02;
      if (i % 30 === 0) surge(s, 1);
      smoothSignals(s, level, DT);
      stepMusicClock(clock, musicTimeRate(s, 1, true), DT);
      expect(clock.rate).toBeGreaterThanOrEqual(MIN_TIME_RATE);
      // The speed glides: no frame changes it by more than a few percent.
      expect(Math.abs(clock.rate - prevRate)).toBeLessThan(0.08);
      prevRate = clock.rate;
    }
  });

  it('keeps normal time at Amount 0 and with no music', () => {
    const s = freshSmoothSignals();
    expect(musicTimeRate(s, 0, true)).toBe(1);
    expect(musicTimeRate({ att: 0.9, usual: 0.1, pulse: 1 }, 1, false)).toBe(1);
  });

  it('gives a renderer that keeps its own time a phase that lands on the clock and runs on at its speed', () => {
    const time = 100;
    const offset = -3;
    const rate = 1.5;
    const phase = musicTimePhase(time, offset, rate);
    expect(time * rate + phase).toBeCloseTo(time + offset, 9);
    // A tenth of a second later the renderer is a tenth further at the clock's speed.
    expect((time + 0.1) * rate + phase).toBeCloseTo(time + offset + 0.15, 9);
  });
});

describe('attack and release', () => {
  it('rises fast and falls slowly', () => {
    let up = 0;
    let down = 1;
    for (let i = 0; i < 6; i++) {
      up = attackRelease(up, 1, DT, 0.05, 0.5);
      down = attackRelease(down, 0, DT, 0.05, 0.5);
    }
    expect(up).toBeGreaterThan(0.8);
    expect(down).toBeGreaterThan(0.75);
    expect(attackRelease(0.3, 1, 0, 0.05, 0.5)).toBe(0.3);
  });

  it('swell follows the envelope with a soft rise and a long fall', () => {
    const s = freshSmoothSignals();
    for (let i = 0; i < 30; i++) smoothSignals(s, 1, DT);
    expect(s.swell).toBeGreaterThan(0.9);
    for (let i = 0; i < 15; i++) smoothSignals(s, 0, DT);
    expect(s.swell).toBeGreaterThan(0.5);
    for (let i = 0; i < 180; i++) smoothSignals(s, 0, DT);
    expect(s.swell).toBeLessThan(0.05);
  });
});

describe('pulse', () => {
  it('eases in on a hit and decays', () => {
    const s = freshSmoothSignals();
    surge(s, 1);
    const frames: number[] = [];
    for (let i = 0; i < 90; i++) {
      smoothSignals(s, 0, DT);
      frames.push(s.pulse);
    }
    const peak = frames.indexOf(Math.max(...frames));
    expect(peak).toBeGreaterThan(0);
    expect(frames[peak]).toBeGreaterThan(0.6);
    expect(frames[89]).toBeLessThan(0.15);
    for (let i = peak + 1; i < frames.length; i++) expect(frames[i]).toBeLessThanOrEqual(frames[i - 1] + 1e-9);
  });
});

describe('morph', () => {
  it('steps towards each hit and accumulates', () => {
    const s = freshSmoothSignals();
    for (let hit = 1; hit <= 3; hit++) {
      surge(s, 1);
      for (let i = 0; i < 60; i++) smoothSignals(s, 0, DT);
      expect(s.morph).toBeGreaterThan(hit - 0.05);
      expect(s.morph).toBeLessThan(hit + 0.05);
    }
  });
});

const input = (NAME: string, TYPE: ISFInputDef['TYPE'] = 'float', extra: Partial<ISFInputDef> = {}): ISFInputDef => ({ NAME, TYPE, MIN: 0, MAX: 1, ...extra });

describe('picking params', () => {
  it('takes float params whose names suggest motion, skipping the rest', () => {
    const inputs = [
      input('inputImage', 'image'),
      input('invert', 'bool'),
      input('tint', 'color'),
      input('reset', 'event'),
      input('seed'),
      input('speed'),
      input('zoom'),
      input('hueShift'),
      input('glow'),
      input('mode', 'long', { VALUES: [0, 1] }),
      input('intensity'),
    ];
    expect(pickMusicMotionParams(inputs)).toEqual(['speed', 'zoom', 'hueShift', 'glow']);
  });

  it('falls back to the first plain float params', () => {
    expect(pickMusicMotionParams([input('a'), input('b'), input('c')])).toEqual(['a', 'b']);
    expect(pickMusicMotionParams([input('flag', 'bool')])).toEqual([]);
  });

  it('keeps a chosen set to the params the shader still has', () => {
    const inputs = [input('speed'), input('zoom'), input('on', 'bool')];
    expect(musicMotionParams({ on: true, amount: 1, params: ['zoom', 'gone', 'on'] }, inputs)).toEqual(['zoom']);
    expect(musicMotionParams({ on: true, amount: 1 }, inputs)).toEqual(['speed', 'zoom']);
  });
});

describe('driven values', () => {
  it('moves around the param value, scaled by Amount, inside the range', () => {
    const loud = { swell: 1, pulse: 1, morph: 2 };
    const still = drivenParamValue(0.5, 0, 1, 'pulse', loud, 0);
    expect(still).toBe(0.5);
    const half = drivenParamValue(0.5, 0, 1, 'pulse', loud, 0.5);
    const full = drivenParamValue(0.5, 0, 1, 'pulse', loud, 1);
    expect(half).toBeGreaterThan(0.5);
    expect(full).toBeGreaterThan(half);
    for (const role of ['swell', 'pulse', 'morph'] as const) {
      const v = drivenParamValue(0.95, 0, 1, role, loud, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // At the top a push turns round, so the param still moves.
    expect(drivenParamValue(1, 0, 1, 'pulse', loud, 1)).toBeLessThan(1);
  });
});

describe('saved settings', () => {
  it('normalizes what a project file holds', () => {
    expect(normalizeMusicMotion(undefined)).toBeUndefined();
    expect(normalizeMusicMotion('yes')).toBeUndefined();
    expect(normalizeMusicMotion({ on: true, amount: 3 })).toEqual({ on: true, amount: 1 });
    expect(normalizeMusicMotion({ on: 'true', amount: 'x' })).toEqual({ on: false, amount: 0.6 });
    expect(normalizeMusicMotion({ on: true, amount: -1, params: ['a', 4, 'a', '', 'b'] })).toEqual({ on: true, amount: 0, params: ['a', 'b'] });
  });
});

describe('music time in shader code', () => {
  const code = `/*{
  "INPUTS": [{ "NAME": "speed", "TYPE": "float", "DEFAULT": 1 }]
}*/
uniform float TIME;
void main() { float t = TIME * speed; gl_FragColor = vec4(sin(t)); }`;

  it('adds rate and phase inputs and reads TIME through them', () => {
    const out = withMusicTime(code);
    const header = JSON.parse(out.slice(out.indexOf('/*') + 2, out.indexOf('*/')));
    expect(header.INPUTS.map((i: any) => i.NAME)).toEqual(['speed', MUSIC_TIME_RATE_INPUT, MUSIC_TIME_PHASE_INPUT]);
    expect(out).toContain('uniform float TIME;');
    expect(out).toContain(`float t = (TIME * ${MUSIC_TIME_RATE_INPUT} + ${MUSIC_TIME_PHASE_INPUT}) * speed;`);
    expect(withMusicTime(out)).toBe(out);
  });

  it('leaves code it cannot read alone', () => {
    expect(withMusicTime('void main() {}')).toBe('void main() {}');
    expect(withMusicTime('/* not json */ void main() {}')).toBe('/* not json */ void main() {}');
  });
});
