import { describe, expect, it } from 'vitest';
import { DUB_SHOT_COUNT, defaultDubShots, divisionBeats, normalizeDubShots } from './dubShots';

describe('dub shots', () => {
  it('ship a full grid of presets that survive a save and load', () => {
    const d = defaultDubShots();
    expect(d).toHaveLength(DUB_SHOT_COUNT);
    expect(normalizeDubShots(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('fill gaps and keep values in range', () => {
    const out = normalizeDubShots([{ name: 'Mine', feedback: 7, pitch: 99, echo: 'nope', division: '1/4.' }]);
    expect(out).toHaveLength(DUB_SHOT_COUNT);
    expect(out[0]).toMatchObject({ name: 'Mine', feedback: 1, pitch: 24, echo: 'digital', division: '1/4.' });
    expect(out[1]).toEqual(defaultDubShots()[1]);
  });

  it('keep a saved grid of the first twelve in place, with the new pads after', () => {
    const old = defaultDubShots().slice(0, 12).map((d) => ({ ...d, name: `${d.name} (mine)` }));
    const out = normalizeDubShots(old);
    expect(out.slice(0, 12).map((d) => d.name)).toEqual(old.map((d) => d.name));
    expect(out.slice(12)).toEqual(defaultDubShots().slice(12));
  });

  it('time their echoes in beats', () => {
    expect(divisionBeats('1/8.')).toBe(0.75);
    expect(divisionBeats('1 bar')).toBe(4);
  });
});
