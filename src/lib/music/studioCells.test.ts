import { describe, expect, it } from 'vitest';
import { cellSetupOf, pickStudioCell, playingStudioCells, studioCellLabel } from './studioCellsCore';
import { STUDIO_EFFECT_TYPE } from './studioPlugin';

const cell = (id: string) => ({ id, name: 'Music Studio', type: 'effect', effectSource: { effectType: STUDIO_EFFECT_TYPE } }) as never;
const other = { id: 'x', name: 'Clip', type: 'effect', effectSource: { effectType: 'ghostfx' } } as never;

describe('one studio cell at a time', () => {
  it('finds the studio cells playing on both decks', () => {
    const st = { layerStates: [{ activeClip: cell('a') }, { activeClip: other }], bankBLayerStates: [{ activeClip: cell('b') }] };
    expect(playingStudioCells(st)).toEqual([{ deck: 'A', layer: 0, clipId: 'a' }, { deck: 'B', layer: 0, clipId: 'b' }]);
  });
  it('the one just launched plays; the one that was playing stops', () => {
    const a = { deck: 'A' as const, layer: 0, clipId: 'a' };
    const b = { deck: 'A' as const, layer: 2, clipId: 'b' };
    expect(pickStudioCell([a, b], 'a')).toEqual({ keep: b, stop: [a] });
    expect(pickStudioCell([a], 'a')).toEqual({ keep: a, stop: [] });
    expect(pickStudioCell([], 'a')).toEqual({ keep: null, stop: [] });
  });
  it('names a cell after its scene, else its set and key', () => {
    const base = { set: 'machine' as const, key: { root: 2, scale: 'dorian' as const }, scenes: [], sceneId: null };
    expect(studioCellLabel(base)).toBe('Drum machine · D Dorian');
    expect(studioCellLabel({ ...base, scenes: [{ id: 's', name: 'Chorus' }] as never, sceneId: 's' })).toBe('Chorus');
  });
  it('reads a saved cell setup, or none', () => {
    expect(cellSetupOf({ effectType: STUDIO_EFFECT_TYPE })).toBeNull();
    const back = cellSetupOf({ musicSetup: { setup: { set: 'dub' }, machine: null, bpm: 140, label: 'Dub · C Minor' } });
    expect(back?.bpm).toBe(140);
    expect(back?.setup).toEqual({ set: 'dub' });
    expect(back?.machine.parts.length).toBeGreaterThan(0);
  });
});
