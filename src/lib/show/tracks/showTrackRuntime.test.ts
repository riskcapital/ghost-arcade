/**
 * The show-track runtime's template refresh: a track's copy of its layer
 * follows the layer while the project keeps changing (modulation writes it
 * every frame), not only once it has been still for a while.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Layer, Project } from '../../types';

vi.mock('../../sync/nativeRendererSync', () => ({ getActiveNativeRendererSync: () => null }));
vi.mock('../../renderer/nativeVideoScrubber', () => ({ createNativeVideoScrubber: () => ({ seek: () => {}, cancel: () => {} }) }));
vi.mock('../../api/native-renderer', () => ({
  getNativeRendererStatus: async () => null,
  prefetchNativeRendererMedia: async () => null,
  probeNativeVideo: async () => null,
  submitNativeRendererCommands: async () => null,
}));
vi.mock('./showTrackActions', () => ({ addTrackForLayer: () => null, addTrackForNewLayer: () => null }));

const { installShowTrackRuntime } = await import('./showTrackRuntime');
const { showTimeline, setShowCompositionLoader } = await import('../../stores/showTimeline');

const wall = (opacity: number) => ({ id: 'L1', name: 'Wall', type: 'media', visible: true, opacity, source: null }) as unknown as Layer;

describe('track templates while the project keeps changing', () => {
  let dispose: (() => void) | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
  });
  afterEach(() => {
    dispose?.();
    dispose = null;
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
    vi.useRealTimers();
  });

  it('refreshes at a steady pace, and saves the layer as it is', () => {
    const project = writable({ layers: [wall(1)] } as unknown as Project);
    dispose = installShowTrackRuntime({ project });
    showTimeline.addLayerTrack(wall(1));
    // Sixty changes a second for two seconds (an LFO on the layer).
    let opacity = 1;
    for (let i = 0; i < 120; i++) {
      opacity = 1 - i / 240;
      project.set({ layers: [wall(opacity)] } as unknown as Project);
      vi.advanceTimersByTime(16);
    }
    const followed = get(showTimeline).layerTracks[0].template!.opacity;
    expect(followed).toBeLessThan(0.75);
    // A save never carries a stale copy.
    expect(showTimeline.serialize().layerTracks![0].template!.opacity).toBe(opacity);
  });
});
