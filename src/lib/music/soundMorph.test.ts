import { describe, expect, it } from 'vitest';
import { morphedVolumesFor, soundParamsFor } from './soundMorph';

const volumes = { synth: 0.8, keys: 0.8, drums: 0.9, drone: 0.75, bowls: 0.8, acid: 0.75, xy: 0.7, dubbass: 0.85, siren: 0.6, shots: 0.7, analog: 0.75, scan: 0.6 };

describe('the sound bath XY pad', () => {
  it('leaves every other sound at its level, wherever it is', () => {
    for (const [x, y] of [[0, 0], [1, 1], [0.1, 0.9]]) {
      const s = { set: 'bath', params: { 'xy.x': x, 'xy.y': y, 'fx.reverb.mix': 0.5, 'fx.shimmer.mix': 0.35 }, volumes };
      expect(morphedVolumesFor(s, false)).toEqual(volumes);
      expect(soundParamsFor(s, false)['fx.reverb.mix']).toBe(0.5);
      expect(soundParamsFor(s, false)['fx.shimmer.mix']).toBe(0.35);
    }
  });
  it('keeps the dub drop and throw', () => {
    const s = { set: 'dub', params: {}, volumes };
    expect(morphedVolumesFor(s, true)).toMatchObject({ drums: 0, dubbass: 0, drone: 0.75 });
    expect(soundParamsFor(s, true)['fx.echo.mix']).toBe(1);
  });
});

describe('the bowls channel', () => {
  it('has its strip on the Sound bath, and its fader is not overridden by the XY pad', async () => {
    const { AUDIO_SOURCES } = await import('./studioSets');
    expect(AUDIO_SOURCES.bath).toContain('bowls');
    const s = { set: 'bath', params: { 'xy.x': 0 }, volumes: { ...volumes, bowls: 0.3 } };
    expect(morphedVolumesFor(s, false).bowls).toBe(0.3);
  });
});
