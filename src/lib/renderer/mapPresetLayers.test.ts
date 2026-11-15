/**
 * The MAP preset group a build publishes is never changed by a later build:
 * the cache hands back the same group while its row's settings stay, and a
 * new one when they change.
 */
import { describe, expect, it } from 'vitest';
import { createLayer, type Composition, type Layer } from '../types';
import { buildMapPresetLayers, mapPresetGroupId, mapPresetRows, type MapPresetCacheEntry, type MapPresetRow } from './mapPresetLayers';

function preset(id: string): Composition {
  const layer = createLayer(`${id}-piece`, 'Piece', 'media');
  return { id, name: id, createdAt: 0, layers: [layer] } as Composition;
}

const compA = preset('A');

function row(extra: Partial<MapPresetRow> = {}): MapPresetRow {
  return { key: '0', label: 'L1', composition: compA, opacity: 1, blendMode: 'normal', effects: undefined, ...extra };
}

function build(rows: MapPresetRow[], cache: Map<string, MapPresetCacheEntry>): Layer[] {
  return buildMapPresetLayers(rows, { liveLayers: [], surfaces: undefined, cache });
}

const groupOf = (list: Layer[]) => list.find((l) => l.id === mapPresetGroupId('0'))!;

describe('MAP preset groups', () => {
  it('leaves the group of the previous build as it was when the row changes', () => {
    const cache = new Map<string, MapPresetCacheEntry>();
    const first = build([row({ opacity: 0.8 })], cache);
    const firstGroup = groupOf(first);
    const snapshot = JSON.parse(JSON.stringify(firstGroup));
    Object.freeze(firstGroup);

    const second = build([row({ opacity: 0.3, blendMode: 'screen', xfade: { deck: 'a', base: 0.6 } })], cache);
    const secondGroup = groupOf(second);
    expect(secondGroup).not.toBe(firstGroup);
    expect(secondGroup).toMatchObject({ opacity: 0.3, blendMode: 'screen', _xfadeFrame: { opacity: { deck: 'a', base: 0.6 } } });
    expect(JSON.parse(JSON.stringify(firstGroup))).toEqual(snapshot);

    // The fader tag goes when the crossfader is off; the tagged group stays tagged.
    const third = groupOf(build([row({ opacity: 0.3, blendMode: 'screen' })], cache));
    expect(third._xfadeFrame).toBeUndefined();
    expect(secondGroup._xfadeFrame).toBeDefined();
  });

  it('hands back the same group while the row is the same', () => {
    const cache = new Map<string, MapPresetCacheEntry>();
    const effects = [{ id: 'fx', type: 'invert', enabled: true, params: {}, opacity: 1 }] as unknown as Layer['effects'];
    const rows = () => [row({ opacity: 0.5, effects, xfade: { deck: 'b', base: 1 } })];
    const a = groupOf(build(rows(), cache));
    const b = groupOf(build(rows(), cache));
    expect(b).toBe(a);
    // No row effects: one shared empty list, so the group is still reused.
    const c = groupOf(build([row()], cache));
    expect(groupOf(build([row()], cache))).toBe(c);
  });

  it('builds from the launcher as before: row opacity, master and the name', () => {
    const state = {
      layerStates: [{ opacity: 0.5, blendMode: 'add', solo: false, mute: false, effects: [], activeClip: { id: 'c', type: 'preset', presetId: 'A', name: 'A', src: '' } }],
      bankBLayerStates: [], crossfaderEnabled: false, masterOpacity: 0.8,
    } as never;
    const sequencer = { isPlaying: false, opacityOverrides: {}, bankBOpacityOverrides: {} } as never;
    const group = groupOf(build(mapPresetRows(state, [compA], sequencer, null), new Map()));
    expect(group).toMatchObject({ opacity: 0.4, blendMode: 'add', name: 'MAP L1: A' });
  });
});
