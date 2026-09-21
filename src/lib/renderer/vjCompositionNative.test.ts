import { describe, expect, it } from 'vitest';
import { createLayer, type Effect } from '../types';
import { appendNativeVjMixCarrier, vjStageScreenLayers } from './vjCompositionNative';
const row = (id: string, opacity = 1) => ({ ...createLayer(id, id, 'media'), opacity });
const fx = { id: 'invert-test', type: 'invert', enabled: true, params: {}, mix: 1 } as Effect;

describe('native VJ composition presentation', () => {
  it('presents composition effects without requiring a group, with row opacity applied only in the mix', () => {
    const input = [row('vj-layer-0', 0.4), row('vj-layer-1', 0.7)];
    const result = appendNativeVjMixCarrier(input, [], [fx]);
    const shown = result.filter(l => l.visible && l.opacity > 0);
    expect(shown.map(l => l.id)).toEqual(['__vj-mix__']);
    expect(shown[0].effects).toEqual([fx]);
    expect(shown[0].source?.effectSource?.vjmixRows).toEqual([
      { layerId: 'vj-layer-1', opacity: 0.7, blendMode: 'normal', groupId: undefined },
      { layerId: 'vj-layer-0', opacity: 0.4, blendMode: 'normal', groupId: undefined },
    ]);
    expect(input.map(l => l.opacity)).toEqual([0.4, 0.7]);
  });
  it('keeps the post-crossfade row, instead of compositing both deck residents again', () => {
    const result = appendNativeVjMixCarrier([row('vj-layer-0-A', 0), row('vj-layer-0-B', 0), row('vj-xfade-0')], [], [fx]);
    expect(result.at(-1)?.source?.effectSource?.vjmixRows).toEqual([
      { layerId: 'vj-xfade-0', opacity: 1, blendMode: 'normal', groupId: undefined },
    ]);
    expect(result.filter(l => l.opacity > 0).map(l => l.id)).toEqual(['__vj-mix__']);
  });
  it('uses the same single output when groups are added or effects are bypassed', () => {
    for (const effects of [[fx], []]) {
      const result = appendNativeVjMixCarrier([row('vj-layer-0')], [{ id: 'g', name: 'Group', first: 0, last: 0, opacity: 0.5, blendMode: 'normal', effects: [] }], effects);
      expect(result.filter(l => l.opacity > 0).map(l => l.id)).toEqual(['__vj-mix__']);
      expect(result.at(-1)?.source?.effectSource?.vjmixRows?.[0].groupId).toBe('g');
      expect(result.at(-1)?.effects).toEqual(effects);
    }
  });
  it('leaves an empty stack empty', () => { expect(appendNativeVjMixCarrier([], [], [fx])).toEqual([]); });
});


it('limits Stage output to screen slices and their groups', () => {
  const screen = { ...createLayer('screen', 'Slice', 'screen'), parentGroupId: 'screen-group' };
  const group = createLayer('screen-group', 'Screens', 'group');
  const custom = { ...createLayer('custom', 'Mapping shape', 'media'), parentGroupId: group.id };
  const media = createLayer('media', 'Mapping video', 'media');
  const unusedGroup = createLayer('other-group', 'Other', 'group');
  expect(vjStageScreenLayers([group, screen, custom, media, unusedGroup]).map(l => l.id)).toEqual(['screen-group', 'screen']);
  expect(vjStageScreenLayers([custom, media, unusedGroup])).toEqual([]);
});


it('includes Performer worlds above their own row inside the group and composition mix', () => {
  const world = { ...row('performer-world-A-1', 0.65), blendMode: 'add' as const };
  const result = appendNativeVjMixCarrier([world, row('vj-layer-0'), row('vj-layer-1')],
    [{ id: 'g', name: 'World group', first: 1, last: 1, opacity: 0.5, blendMode: 'normal', effects: [] }], [fx]);
  expect(result.at(-1)?.source?.effectSource?.vjmixRows).toEqual([
    { layerId: 'vj-layer-1', opacity: 1, blendMode: 'normal', groupId: 'g' },
    { layerId: world.id, opacity: 0.65, blendMode: 'add', groupId: 'g' },
    { layerId: 'vj-layer-0', opacity: 1, blendMode: 'normal', groupId: undefined },
  ]);
  expect(result.find(l => l.id === world.id)?.opacity).toBe(0);
  expect(result.at(-1)?.effects).toEqual([fx]);
});

it('preserves deck-weighted worlds once alongside the crossfade carrier', () => {
  const result = appendNativeVjMixCarrier([
    row('performer-world-A-0', 0.8), row('performer-world-B-0', 0.2),
    row('vj-layer-0-A', 0), row('vj-layer-0-B', 0), row('vj-xfade-0'),
  ], [], []);
  expect(result.at(-1)?.source?.effectSource?.vjmixRows?.map(r => [r.layerId, r.opacity])).toEqual([
    ['vj-xfade-0', 1], ['performer-world-A-0', 0.8], ['performer-world-B-0', 0.2],
  ]);
});
