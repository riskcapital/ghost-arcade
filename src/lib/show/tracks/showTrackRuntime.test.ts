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
    const rowId = showTimeline.addLayerTrack(wall(1));
    showTimeline.addLayerClip(rowId, { kind: 'image', name: 'a.png', src: 'a.png' }, 0);
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

  it('a project being opened holds the row sync until its own show is hydrated', async () => {
    vi.useRealTimers();
    const project = writable({ layers: [wall(1)] } as unknown as Project);
    showTimeline.openDoc('timeline');
    dispose = installShowTrackRuntime({ project });
    await Promise.resolve();
    showTimeline.syncStageRows([wall(1)], []);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    let hydrated = false;
    const early: unknown[] = [];
    const spy = vi.spyOn(showTimeline, 'syncStageRows').mockImplementation(() => { if (!hydrated) early.push(1); });
    // What importProject does: the new layers land, the show follows a microtask later.
    showTimeline.expectHydrate();
    project.set({ layers: [{ ...wall(1), id: 'L2' }] } as unknown as Project);
    queueMicrotask(() => { showTimeline.hydrate(saved); hydrated = true; showTimeline.hydrateSettled(); });
    await new Promise((r) => setTimeout(r, 5));
    expect(early).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
