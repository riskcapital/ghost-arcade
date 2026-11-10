/**
 * Clicking a block points the panels at it: they read the block's own
 * values, and their edits go into the block, never into the mapping layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../types';

const state = writable<{ layers: Layer[]; selectedLayerId: string | null }>({ layers: [], selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: {
    subscribe: state.subscribe,
    selectLayer: (id: string | null) => state.update((s) => ({ ...s, selectedLayerId: id })),
  },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));

const { showTimeline, setShowCompositionLoader } = await import('../../stores/showTimeline');
const { activeBlock, editBlock, setBlockShaderValue, setBlockBlendMode, setBlockOpacity, setBlockSketchParam, stopEditingBlock } = await import('./showBlockEdit');
const { rowTrackId } = await import('./showStageRows');

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 0.8, blendMode: 'screen', source: { id: `own-${id}`, type: 'shader', src: 'ISF/Own.fs', name: 'own', shaderValues: { amount: 0.5 } }, ...extra } as unknown as Layer;
}
const shader: ShowClipMedia = { kind: 'shader', name: 'Glow', src: 'ISF/Glow.fs', shaderCode: 'void main(){}', shaderValues: { amount: 0.25 } };

describe('editing a block in the normal panels', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    state.set({ layers: [layer('A'), layer('B')], selectedLayerId: null });
    showTimeline.syncStageRows(get(state).layers, []);
  });
  afterEach(() => {
    stopEditingBlock();
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  function pick(trackId: string, clipId: string) {
    showTimeline.selectLayerClips([clipId]);
    editBlock({ id: trackId, layerId: get(showTimeline).layerTracks.find((t) => t.id === trackId)!.layerId }, { id: clipId });
  }

  it('selects the piece and shows the block\'s own values', () => {
    const clipId = showTimeline.addLayerClip(rowTrackId('A'), shader, 0)!;
    pick(rowTrackId('A'), clipId);
    expect(get(state).selectedLayerId).toBe('A');
    const block = get(activeBlock)!;
    expect(block.layer.id).toBe('A');
    expect(block.layer.source?.shaderValues).toEqual({ amount: 0.25 });
    expect(block.layer.source?.src).toBe('ISF/Glow.fs');
    // The block's opacity and blend (unset: the piece's on its own row).
    expect(block.layer.opacity).toBe(1);
    expect(block.layer.blendMode).toBe('screen');
  });

  it('writes edits to the block, never to the layer', () => {
    const clipId = showTimeline.addLayerClip(rowTrackId('A'), shader, 0)!;
    pick(rowTrackId('A'), clipId);
    const before = get(state).layers;
    expect(setBlockShaderValue('amount', 0.9)).toBe(true);
    expect(setBlockOpacity(0.4)).toBe(true);
    expect(setBlockBlendMode('add')).toBe(true);
    const clip = showTimeline.findLayerClip(clipId)!.clip;
    expect(clip.media.shaderValues).toEqual({ amount: 0.9 });
    expect(clip.opacity).toBe(0.4);
    expect(clip.blendMode).toBe('add');
    expect(get(state).layers).toBe(before);
    expect(get(activeBlock)!.layer.source?.shaderValues).toEqual({ amount: 0.9 });
  });

  it('sketch parameters go into the block too', () => {
    const sketch: ShowClipMedia = { kind: 'sketch', name: 'Dots', src: 'js-animation', jsAnimation: { animationType: 'p5js', htmlCode: '<html></html>', params: [{ name: 'size', type: 'number' }], paramValues: { size: 1 } } as any };
    const clipId = showTimeline.addLayerClip(rowTrackId('B'), sketch, 0)!;
    pick(rowTrackId('B'), clipId);
    expect(setBlockSketchParam('size', 3)).toBe(true);
    expect(showTimeline.findLayerClip(clipId)!.clip.media.jsAnimation?.paramValues).toEqual({ size: 3 });
  });

  it('lets go when another layer is selected or the block is deselected', () => {
    const clipId = showTimeline.addLayerClip(rowTrackId('A'), shader, 0)!;
    pick(rowTrackId('A'), clipId);
    expect(get(activeBlock)).not.toBeNull();
    state.update((s) => ({ ...s, selectedLayerId: 'B' }));
    expect(get(activeBlock)).toBeNull();
    expect(setBlockShaderValue('amount', 0.1)).toBe(false);
    state.update((s) => ({ ...s, selectedLayerId: 'A' }));
    expect(get(activeBlock)).not.toBeNull();
    showTimeline.selectLayerClips([]);
    expect(get(activeBlock)).toBeNull();
  });

  it('a block on a layer added on the piece blends normally unless it says', () => {
    const sub = showTimeline.addSubRow('A')!;
    const clipId = showTimeline.addLayerClip(sub, shader, 0)!;
    pick(sub, clipId);
    expect(get(activeBlock)!.layer.blendMode).toBe('normal');
  });
});
