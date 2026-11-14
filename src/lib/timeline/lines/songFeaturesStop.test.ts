/**
 * Stopping a song analysis: a caller that stops gets null at once; the
 * shared analysis ends only when everyone waiting for it has stopped, and
 * an ended one is not cached. Not stopped, the features are the same.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeSongFeatures, clearSongFeatureCache, cachedSongFeatures, pendingSongFeatureCount, songFeatureAnalysisCount, songFeaturesFor } from './songFeatures';

const RATE = 22050;
function loop(seconds = 6): Float32Array {
  const out = new Float32Array(seconds * RATE);
  for (let i = 0; i < out.length; i++) {
    const local = (i / RATE) % 0.5;
    out[i] = local < 0.08 ? Math.sin(2 * Math.PI * 60 * local) * Math.exp(-local * 40) : 0.01 * Math.sin(i);
  }
  return out;
}

/** A decode that waits until it is let go. */
function gatedLoad() {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const load = async () => { calls++; await gate; return { mono: loop(), sampleRate: RATE }; };
  return { load, release: () => release(), calls: () => calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => clearSongFeatureCache());

describe('stopping a song analysis', () => {
  it('one caller stops: null at once, nothing analysed or cached, and the next call starts afresh', async () => {
    clearSongFeatureCache();
    const before = songFeatureAnalysisCount();
    const g = gatedLoad();
    const stop = new AbortController();
    const got = songFeaturesFor('a.wav', g.load, stop.signal);
    stop.abort();
    expect(await got).toBeNull();
    expect(pendingSongFeatureCount()).toBe(0);
    g.release();
    await settle();
    expect(songFeatureAnalysisCount()).toBe(before);
    expect(cachedSongFeatures('a.wav')).toBeNull();
    const again = await songFeaturesFor('a.wav', async () => ({ mono: loop(), sampleRate: RATE }));
    expect(again).toEqual(analyzeSongFeatures(loop(), RATE));
  });

  it('another caller still waiting keeps the analysis going (with or without a signal)', async () => {
    for (const second of ['signal', 'none'] as const) {
      clearSongFeatureCache();
      const g = gatedLoad();
      const stopA = new AbortController();
      const a = songFeaturesFor('b.wav', g.load, stopA.signal);
      const b = songFeaturesFor('b.wav', g.load, second === 'signal' ? new AbortController().signal : undefined);
      stopA.abort();
      expect(await a).toBeNull();
      g.release();
      const features = await b;
      expect(features).toEqual(analyzeSongFeatures(loop(), RATE));
      expect(cachedSongFeatures('b.wav')).toBe(features);
      expect(g.calls()).toBe(1);
    }
  });

  it('everyone stops: the analysis ends', async () => {
    clearSongFeatureCache();
    const before = songFeatureAnalysisCount();
    const g = gatedLoad();
    const s1 = new AbortController();
    const s2 = new AbortController();
    const a = songFeaturesFor('c.wav', g.load, s1.signal);
    const b = songFeaturesFor('c.wav', g.load, s2.signal);
    s1.abort();
    expect(pendingSongFeatureCount()).toBe(1);
    s2.abort();
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(pendingSongFeatureCount()).toBe(0);
    g.release();
    await settle();
    expect(songFeatureAnalysisCount()).toBe(before);
  });

  it('a stopped signal on a cached song still gives the song', async () => {
    clearSongFeatureCache();
    const first = await songFeaturesFor('d.wav', async () => ({ mono: loop(), sampleRate: RATE }));
    expect(await songFeaturesFor('d.wav', async () => null, AbortSignal.abort())).toBe(first);
  });
});
