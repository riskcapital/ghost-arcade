import { describe, it, expect } from 'vitest';
import { packAtlas, sliceOutputSize, isAtlasSenderSlice, atlasLayoutSignature } from './atlasLayout';
import type { OutputSlice } from '../stores/settings';

function slice(over: Partial<OutputSlice>): OutputSlice {
  return {
    id: 's', name: 's', enabled: true,
    cropX: 0, cropY: 0, cropW: 0.5, cropH: 1,
    targetType: 'sender', outputType: 'spout', spoutName: 'ghostArcade-s',
    edgeBlendLeft: 0, edgeBlendRight: 0, edgeBlendTop: 0, edgeBlendBottom: 0,
    edgeBlendGamma: 2.2, brightness: 1, gamma: 1, contrast: 1, rotation: 0,
    ...over,
  } as OutputSlice;
}

describe('sliceOutputSize', () => {
  it('scales crop to master pixels', () => {
    expect(sliceOutputSize(slice({ cropW: 0.5, cropH: 1 }), 1920, 1080)).toEqual({ w: 960, h: 1080 });
  });
  it('swaps w/h for 90 and 270', () => {
    expect(sliceOutputSize(slice({ cropW: 0.5, cropH: 1, rotation: 90 }), 1920, 1080)).toEqual({ w: 1080, h: 960 });
    expect(sliceOutputSize(slice({ cropW: 0.5, cropH: 1, rotation: 270 }), 1920, 1080)).toEqual({ w: 1080, h: 960 });
  });
});

describe('isAtlasSenderSlice', () => {
  it('includes spout/syphon senders', () => {
    expect(isAtlasSenderSlice(slice({ outputType: 'spout' }))).toBe(true);
    expect(isAtlasSenderSlice(slice({ outputType: 'syphon' }))).toBe(true);
  });
  it('excludes ndi, display, and disabled', () => {
    expect(isAtlasSenderSlice(slice({ outputType: 'ndi' }))).toBe(false);
    expect(isAtlasSenderSlice(slice({ targetType: 'display' }))).toBe(false);
    expect(isAtlasSenderSlice(slice({ enabled: false }))).toBe(false);
  });
});

describe('packAtlas', () => {
  it('packs two half-width slices side by side', () => {
    const a = slice({ id: 'a', spoutName: 'A', cropX: 0, cropW: 0.5 });
    const b = slice({ id: 'b', spoutName: 'B', cropX: 0.5, cropW: 0.5 });
    const layout = packAtlas([a, b], 1920, 1080, 8192, 2);
    expect(layout.tiles).toHaveLength(2);
    expect(layout.tiles[0]).toMatchObject({ sliceId: 'a', x: 0, y: 0, w: 960, h: 1080 });
    expect(layout.tiles[1]).toMatchObject({ sliceId: 'b', x: 962, y: 0, w: 960, h: 1080 });
    expect(layout.atlasW).toBe(1922); // 960 + 2 + 960
    expect(layout.atlasH).toBe(1080);
    expect(layout.overflow).toBe(false);
  });

  it('wraps to a new shelf when the row exceeds maxDim', () => {
    const wide = (id: string) => slice({ id, spoutName: id, cropW: 1, cropH: 0.25 }); // 1920x270 each
    const layout = packAtlas([wide('a'), wide('b')], 1920, 1080, 2000, 2);
    expect(layout.tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.tiles[1]).toMatchObject({ x: 0, y: 272 }); // wrapped below row 0 (270 + 2)
    expect(layout.atlasH).toBe(542); // 270 + 2 + 270
  });

  it('excludes non-atlas slices', () => {
    const spoutSlice = slice({ id: 'a', spoutName: 'A' });
    const ndiSlice = slice({ id: 'b', spoutName: 'B', outputType: 'ndi' });
    const displaySlice = slice({ id: 'c', spoutName: 'C', targetType: 'display' });
    const layout = packAtlas([spoutSlice, ndiSlice, displaySlice], 1920, 1080);
    expect(layout.tiles.map(t => t.sliceId)).toEqual(['a']);
  });

  it('flags overflow when a tile exceeds maxDim', () => {
    const huge = slice({ id: 'a', spoutName: 'A', cropW: 1, cropH: 1 });
    const layout = packAtlas([huge], 20000, 20000, 8192, 2);
    expect(layout.overflow).toBe(true);
    expect(layout.tiles).toHaveLength(0);
  });

  it('signature changes when geometry changes, stable otherwise', () => {
    const a = slice({ id: 'a', spoutName: 'A' });
    const l1 = packAtlas([a], 1920, 1080);
    const l2 = packAtlas([a], 1920, 1080);
    expect(atlasLayoutSignature(l1)).toBe(atlasLayoutSignature(l2));
    const l3 = packAtlas([slice({ id: 'a', spoutName: 'A', cropW: 0.75 })], 1920, 1080);
    expect(atlasLayoutSignature(l3)).not.toBe(atlasLayoutSignature(l1));
  });
});
