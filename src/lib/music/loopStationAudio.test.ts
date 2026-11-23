import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../stores/launchClock', () => ({
  launchClockPosition: () => ({ beat: 0, beatMs: 500 }),
  launchClockTempo: () => 120,
  resyncLaunchClock: () => true,
}));
let saved = 0;
vi.mock('../storage/assetRegistry', () => ({
  createAssetRefFromGeneratedBlob: async (_b: Blob, name: string) => ({ runtimeUrl: `blob:${name}`, assetRef: { kind: 'local-file', name, originalPath: `/assets/${++saved}-${name}` } }),
  pathToFileUrl: (p: string) => `ghost-asset://localhost${p}`,
  resolveAssetRefForRuntime: (_r: unknown, _d: unknown, cur: string) => cur,
}));

import { musicStudio } from './musicStudioStore';
import { attachLoopStation, flushAudioLoops, publish, undoLoopLayer } from './loopStation';
import type { AudioLoopTracks } from './audioLoopTracks';

/** An audio-track engine with layers in memory only. */
function fakeEngine() {
  const layers: Array<Array<[Float32Array, Float32Array]>> = Array.from({ length: 8 }, () => []);
  const e = {
    onLayersChanged: null as ((i: number) => void) | null,
    layersOf: (i: number) => (layers[i].length ? { layers: layers[i], bars: 2, beatMs: 500, originBeat: 0, sampleRate: 48000 } : null),
    restoreLayers: (i: number, l: Array<[Float32Array, Float32Array]>) => { layers[i] = l; },
    layerCount: (i: number) => layers[i].length,
    add(i: number) { layers[i].push([new Float32Array(10), new Float32Array(10)]); e.onLayersChanged?.(i); },
    undo: (i: number) => { layers[i].pop(); e.onLayersChanged?.(i); return true; },
    info: (i: number) => ({ bars: 2, originBeat: 0, layers: layers[i].length, redo: 0 }),
    canRecord: () => true, state: () => 'stopped', clearAll: () => {}, peaks: () => [],
    setLevel: () => {}, sampleRate: () => 48000,
  };
  return e;
}

describe('audio loop tracks kept with the project', () => {
  it('writes each layer once as a project asset, and follows undo', async () => {
    const e = fakeEngine();
    attachLoopStation({ send: () => {}, now: () => 0, click: () => {}, played: () => [], clockBusy: () => false, wake: () => {}, audioTracks: () => e as unknown as AudioLoopTracks });
    publish();
    e.add(4);
    e.add(4);
    await flushAudioLoops();
    let a = get(musicStudio).loopStation.tracks[4].audio!;
    expect(a.layers).toHaveLength(2);
    expect(a.layers[0].src).toMatch(/^ghost-asset:/);
    expect(saved).toBe(2);
    e.add(4);
    await flushAudioLoops();
    // Only the new layer is written.
    expect(saved).toBe(3);
    undoLoopLayer(4);
    await flushAudioLoops();
    a = get(musicStudio).loopStation.tracks[4].audio!;
    expect(a.layers).toHaveLength(2);
    expect(saved).toBe(3);
    // A saved project keeps them in its loop station section.
    expect(JSON.stringify(musicStudio.serialize().loopStation)).toContain('_assetRef');
  });
});
