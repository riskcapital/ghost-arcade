/**
 * Detect tempo with a signal: stopped, it answers 'stopped' and sets
 * nothing; not stopped, the same tempo as without one.
 */
import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const RATE = 22050;
function thumps(seconds: number, bpm: number): Float32Array {
  const out = new Float32Array(seconds * RATE);
  for (let t = 0.1; t < seconds; t += 60 / bpm) {
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.06 * RATE && at + i < out.length; i++) out[at + i] += 0.8 * Math.exp(-i / (0.012 * RATE)) * Math.sin((2 * Math.PI * 70 * i) / RATE);
  }
  return out;
}

const state = writable({ audioTracks: [{ id: 't', name: 't', url: 'blob:t', startTime: 0, duration: 40, offset: 0, sourceDuration: 40, volume: 1, muted: false, lane: 0 }] });
const setTempo = vi.fn();
vi.mock('../stores/showTimeline', () => ({ showTimeline: { subscribe: state.subscribe, setTempo } }));
let release: () => void = () => {};
vi.mock('../audio/showAudio', () => ({
  cachedShowAudioDecode: () => null,
  decodeShowAudio: async () => {
    await new Promise<void>((r) => { release = r; });
    return { mono: thumps(40, 120), sampleRate: RATE };
  },
}));
const { detectShowTempo } = await import('./tempoDetect');

describe('detect tempo, stopped', () => {
  it('stopped while the song is read: stopped, nothing set', async () => {
    const stop = new AbortController();
    const job = detectShowTempo('t', { signal: stop.signal });
    stop.abort();
    release();
    expect(await job).toEqual({ ok: false, reason: 'stopped' });
    expect(setTempo).not.toHaveBeenCalled();
  });

  it('not stopped: the same answer as without a signal', async () => {
    const withSignal = detectShowTempo('t', { apply: false, signal: new AbortController().signal });
    await Promise.resolve();
    release();
    const a = await withSignal;
    const plain = detectShowTempo('t', { apply: false });
    await Promise.resolve();
    release();
    const b = await plain;
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
    if (a.ok) expect(a.bpm).toBeCloseTo(120, 0);
  });
});
