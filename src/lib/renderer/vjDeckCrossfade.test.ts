import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../types';
import { appendNativeVjDeckCrossfade } from './vjCompositionNative';

const row = (id: string, opacity = 1, blendMode = 'normal'): Layer => ({ ...createLayer(id, id, 'media'), opacity, blendMode } as Layer);

describe('A/B slider between whole decks', () => {
  it('mixes each deck from its own rows and runs the transition between them', () => {
    // Deck A plays on row 0, Deck B on rows 1 and 2: no row is shared.
    const list = [row('vj-layer-0-A'), row('vj-layer-1-B', 0.8, 'screen'), row('vj-layer-2-B')];
    const groups = [{ id: 'g', name: 'g', first: 1, last: 2, opacity: 1, blendMode: 'normal', effects: [] }] as any;
    const out = appendNativeVjDeckCrossfade(list, groups, [], { mix: 0.4, transition: 'wipe', blendMode: 'difference' });
    const byId = new Map(out.map((layer) => [layer.id, layer]));
    const fx = (id: string) => byId.get(id)!.source!.effectSource as any;

    expect(fx('__vj-deck-mix-A__').vjmixRows.map((r: any) => r.layerId)).toEqual(['vj-layer-0-A']);
    // Bottom to top, keeping each row's own opacity, blend and group.
    expect(fx('__vj-deck-mix-B__').vjmixRows).toEqual([
      { layerId: 'vj-layer-2-B', opacity: 1, blendMode: 'normal', groupId: 'g' },
      { layerId: 'vj-layer-1-B', opacity: 0.8, blendMode: 'screen', groupId: 'g' },
    ]);
    expect(fx('__vj-deck-xfade__')).toMatchObject({
      effectType: 'vj-crossfade', vjxfadeLayerA: '__vj-deck-mix-A__', vjxfadeLayerB: '__vj-deck-mix-B__',
      vjxfadeMix: 0.4, vjxfadeTransition: 'wipe', vjxfadeBlend: 'difference',
    });
    expect(fx('__vj-mix__').vjmixRows).toEqual([{ layerId: '__vj-deck-xfade__', opacity: 1, blendMode: 'normal' }]);
    // Only the VJ Mix carrier presents; everything else feeds it.
    expect(out.filter((layer) => layer.opacity > 0).map((layer) => layer.id)).toEqual(['__vj-mix__']);
  });
});
