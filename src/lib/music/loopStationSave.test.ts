import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../stores/launchClock', () => ({
  launchClockPosition: () => ({ beat: 0, beatMs: 500 }),
  launchClockTempo: () => 120,
  resyncLaunchClock: () => true,
}));
/** Each write waits until the test lets it finish (or fail). */
const writes: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
let n = 0;
vi.mock('../storage/assetRegistry', () => ({
  createAssetRefFromGeneratedBlob: (_b: Blob, name: string) =>
    new Promise((resolve, reject) => {
      writes.push({ resolve: () => resolve({ runtimeUrl: '', assetRef: { kind: 'local-file', name, originalPath: `/assets/${++n}-${name}` } }), reject });
    }),
  pathToFileUrl: (p: string) => `ghost-asset://localhost${p}`,
  resolveAssetRefForRuntime: (_r: unknown, _d: unknown, cur: string) => cur,
}));

import { musicStudio } from './musicStudioStore';
import { AUDIO_SAVE_DELAY_MS, _resetStationForTests, attachLoopStation, flushAudioLoops, loopNoteVelocity, publish } from './loopStation';
import type { AudioLoopTracks } from './audioLoopTracks';

function fakeEngine(rate = 48000) {
  const layers: Array<Array<[Float32Array, Float32Array]>> = Array.from({ length: 8 }, () => []);
  const levels: Array<[number, number]> = [];
  const e = {
    onLayersChanged: null as ((i: number) => void) | null,
    layersOf: (i: number) => (layers[i].length ? { layers: layers[i], bars: 2, beatMs: 500, originBeat: 0, sampleRate: rate } : null),
    restoreLayers: (i: number, l: Array<[Float32Array, Float32Array]>) => { layers[i] = l; },
    layerCount: (i: number) => layers[i].length,
    sampleRate: () => rate,
    setLevel: (i: number, v: number) => levels.push([i, v]),
    levels,
    add(i: number) { layers[i].push([new Float32Array(10), new Float32Array(10)]); e.onLayersChanged?.(i); },
    clearAll: () => { layers.forEach((l) => (l.length = 0)); },
    info: () => null, canRecord: () => true, state: () => 'stopped', peaks: () => [],
  };
  return e;
}
const attach = (e: ReturnType<typeof fakeEngine>) => {
  attachLoopStation({ send: () => {}, now: () => 0, click: () => {}, played: () => [], clockBusy: () => false, wake: () => {}, audioTracks: () => e as unknown as AudioLoopTracks });
  publish();
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetStationForTests();
  musicStudio.hydrate(null);
  writes.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('saving a project with looper audio', () => {
  it('waits for a write already under way (its timer gone) before the snapshot', async () => {
    vi.useFakeTimers();
    const e = fakeEngine();
    attach(e);
    e.add(4);
    vi.advanceTimersByTime(AUDIO_SAVE_DELAY_MS);
    vi.useRealTimers();
    await settle();
    expect(writes).toHaveLength(1);
    let flushed = false;
    const f = flushAudioLoops().then(() => (flushed = true));
    await settle();
    expect(flushed).toBe(false);
    writes[0].resolve();
    await f;
    expect(get(musicStudio).loopStation.tracks[4].audio?.layers).toHaveLength(1);
  });

  it('rejects when a write fails, so the save can say so', async () => {
    const e = fakeEngine();
    attach(e);
    e.add(4);
    const f = flushAudioLoops();
    await settle();
    writes[0].reject(new Error('disk full'));
    await expect(f).rejects.toThrow('disk full');
  });

  it('drops a write that finishes after the project was reset', async () => {
    const e = fakeEngine();
    attach(e);
    e.add(4);
    const f = flushAudioLoops();
    await settle();
    musicStudio.hydrate(null);
    writes[0].resolve();
    await f;
    expect(get(musicStudio).loopStation.tracks[4].audio).toBeUndefined();
  });
});

describe('opening a project with looper audio', () => {
  it('decodes at the live rate and puts the saved level and mute on the graph', async () => {
    const rates: number[] = [];
    (globalThis as any).OfflineAudioContext = class {
      constructor(_c: number, _l: number, rate: number) { rates.push(rate); }
      async decodeAudioData() { return { numberOfChannels: 2, getChannelData: () => new Float32Array(4) }; }
    };
    (globalThis as any).fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });
    musicStudio.updateLoopTrack(4, { muted: true, level: 0.5, audio: { bars: 2, beatMs: 500, originBeat: 0, layers: [{ src: 'file:///a.wav' }] } });
    const e = fakeEngine(44100);
    attach(e);
    await settle();
    await settle();
    expect(rates).toEqual([44100]);
    expect(e.layerCount(4)).toBe(1);
    expect(e.levels).toContainEqual([4, 0]);
  });
});

describe('a MIDI loop fader', () => {
  it('scales velocity straight, and is silent at 0', () => {
    expect(loopNoteVelocity(0.8, 0)).toBe(0);
    expect(loopNoteVelocity(0.8, 0.5)).toBeCloseTo(0.4);
    expect(loopNoteVelocity(0.8, 1)).toBeCloseTo(0.8);
  });
});
