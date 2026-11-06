import { describe, expect, it } from 'vitest';
import {
  advanceFlowOffset,
  attackRelease,
  drivenParamValue,
  freshSmoothSignals,
  musicMotionParams,
  musicTimeRate,
  MIN_TIME_RATE,
  MUSIC_TIME_INPUT,
  normalizeMusicMotion,
  pickMusicMotionParams,
  smoothSignals,
  surge,
  withMusicTime,
} from './musicMotion';
import type { ISFInputDef } from '../types';

const DT = 1 / 60;

/** Shader time over `seconds` with the swell held at `swell`. */
function flowTimeAfter(swell: number, seconds: number, amount = 1): number {
  let offset = 0;
  let t = 0;
  for (let i = 0; i < seconds / DT; i++) {
    offset = advanceFlowOffset(offset, musicTimeRate(swell, 0, amount), DT);
    t += DT;
  }
  return t + offset;
}

describe('flow clock', () => {
  it('only moves forward, and never stops dead', () => {
    let offset = 0;
    let prev = -Infinity;
    const s = freshSmoothSignals();
    for (let i = 0; i < 600; i++) {
      const env = i % 120 < 30 ? 1 : 0;
      if (i % 30 === 0) surge(s, 1);
      smoothSignals(s, env, DT);
      offset = advanceFlowOffset(offset, musicTimeRate(s.swell, s.pulse, 1), DT);
      const time = (i + 1) * DT + offset;
      expect(time - prev).toBeGreaterThan(DT * MIN_TIME_RATE * 0.99);
      prev = time;
    }
  });

  it('runs faster when the music is louder', () => {
    const quiet = flowTimeAfter(0, 4);
    const loud = flowTimeAfter(1, 4);
    expect(loud).toBeGreaterThan(quiet * 3);
    expect(quiet).toBeLessThan(4);
    expect(loud).toBeGreaterThan(4);
  });

  it('keeps normal time at Amount 0', () => {
    expect(flowTimeAfter(1, 2, 0)).toBeCloseTo(2, 6);
    expect(musicTimeRate(0, 0, 0)).toBe(1);
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

  it('adds an offset input and reads TIME through it', () => {
    const out = withMusicTime(code);
    const header = JSON.parse(out.slice(out.indexOf('/*') + 2, out.indexOf('*/')));
    expect(header.INPUTS.map((i: any) => i.NAME)).toEqual(['speed', MUSIC_TIME_INPUT]);
    expect(out).toContain('uniform float TIME;');
    expect(out).toContain(`float t = (TIME + ${MUSIC_TIME_INPUT}) * speed;`);
    expect(withMusicTime(out)).toBe(out);
  });

  it('leaves code it cannot read alone', () => {
    expect(withMusicTime('void main() {}')).toBe('void main() {}');
    expect(withMusicTime('/* not json */ void main() {}')).toBe('/* not json */ void main() {}');
  });
});
