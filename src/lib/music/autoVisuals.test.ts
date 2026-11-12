import { describe, expect, it } from 'vitest';
import { idleRowCell } from './studioPlacement';
import { VISUAL_SCENES } from './visualScenes';
import { studioVoicesFromScene } from './studioPlugin';

const clip = { id: 'c' };

describe('visuals on the deck by default', () => {
  it('go on the first row playing nothing, in its first free cell', () => {
    const grid = [[clip, null], [null, null], [null]];
    expect(idleRowCell(grid, [{ activeClip: null }, { activeClip: null }, {}])).toEqual({ layer: 0, column: 1 });
  });

  it('never cover a row that is playing, and skip full rows', () => {
    const grid = [[clip, null], [clip], [clip, null, null]];
    const states = [{ activeClip: clip }, { activeClip: null }, { activeClip: null }];
    expect(idleRowCell(grid, states)).toEqual({ layer: 2, column: 1 });
    expect(idleRowCell([[clip, null]], [{ activeClip: clip }])).toBeNull();
  });

  it('a scene that follows no drums keeps a ground voice, so the beat alone is not black', () => {
    const drums = new Set(['kick', 'snare', 'hats', 'all']);
    for (const scene of VISUAL_SCENES) {
      if (scene.voices.some((v) => drums.has(v.source))) continue;
      const voices = studioVoicesFromScene(scene.voices);
      expect(voices.some((v) => !v.auto), scene.id).toBe(true);
    }
  });
});
