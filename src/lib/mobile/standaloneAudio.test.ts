import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioFrame, AudioSourceKind } from './nativeAudio';

// The native side is replaced by a feed the test controls.
const native = vi.hoisted(() => ({
  frame: null as AudioFrame | null,
  acquired: [] as string[],
  released: [] as string[],
}));
vi.mock('./nativeAudio', async original => ({
  ...(await original<typeof import('./nativeAudio')>()),
  hasNativeAudio: () => true,
  acquireNativeAudio: async (source: AudioSourceKind) => {
    native.acquired.push(source);
    return { frame: () => native.frame, release: () => native.released.push(source) };
  },
}));

import { SILENT_AUDIO, Spring, StandaloneAudio, estimateBpm, spectralCentroid } from './standaloneAudio';

afterEach(() => { native.frame = null; native.acquired = []; native.released = []; });

function nativeFrame(bass: number, rest: number, arriving = true): AudioFrame {
  const spectrum = new Uint8Array(new ArrayBuffer(512)).fill(rest);
  spectrum.fill(bass, 0, 5);
  return { sequence: 1, source: 'player', sampleRate: 48000, arriving, spectrum, waveform: new Uint8Array(new ArrayBuffer(1024)).fill(128) };
}

describe('tempo and brightness', () => {
  it('estimates the tempo from steady beats and ignores a stray one', () => {
    const beats = [0, 500, 1000, 1500, 1730, 2000, 2500, 3000];
    expect(estimateBpm(beats, 0)).toBe(120);
    expect(estimateBpm([0, 500, 1000], 0)).toBe(0);
  });
  it('eases small tempo changes and jumps to big ones', () => {
    expect(estimateBpm([0, 480, 960, 1440, 1920], 120)).toBe(121);
    expect(estimateBpm([0, 750, 1500, 2250, 3000], 120)).toBe(80);
  });
  it('measures where the energy sits in the spectrum', () => {
    expect(spectralCentroid(new Uint8Array(512))).toBe(0);
    const high = new Uint8Array(512); high[400] = 255;
    const low = new Uint8Array(512); low[20] = 255;
    expect(spectralCentroid(high)).toBeCloseTo(400 / 512, 3);
    expect(spectralCentroid(low)).toBeLessThan(spectralCentroid(high));
  });
});

describe('StandaloneAudio on the iPhone and iPad app', () => {
  it('drives the uniforms from native frames, with tempo and beat phase', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('player');
    expect(native.acquired).toEqual(['player']);
    expect(audio.source).toBe('player');
    // A kick every 500 ms (120 BPM) at 60 frames a second for six seconds.
    let sawBeat = false;
    for (let t = 0; t < 6000; t += 1000 / 60) {
      native.frame = nativeFrame(t % 500 < 40 ? 230 : 40, 60);
      audio.update(t);
      if (audio.uniforms.audioBeat > 0.9) sawBeat = true;
    }
    expect(sawBeat).toBe(true);
    expect(audio.arriving).toBe(true);
    expect(audio.uniforms.audioBPM).toBeGreaterThanOrEqual(118);
    expect(audio.uniforms.audioBPM).toBeLessThanOrEqual(122);
    expect(audio.uniforms.audioBeatPhase).toBeGreaterThanOrEqual(0);
    expect(audio.uniforms.audioBeatPhase).toBeLessThan(1);
    expect(audio.uniforms.audioSpectralCentroid).toBeGreaterThan(0);
    expect(audio.uniforms.spectrum?.[0]).toBeGreaterThan(0);
  });

  it('reads a missing frame as silence and says nothing is arriving', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('phone');
    native.frame = null;
    audio.update(16);
    expect(audio.arriving).toBe(false);
    expect(audio.uniforms.spectrum?.every(v => v === 0)).toBe(true);
    expect(audio.uniforms.waveform?.every(v => v === 128)).toBe(true);
  });

  it('takes the new source before letting the old one go, and stops cleanly', async () => {
    const audio = new StandaloneAudio();
    await audio.start();
    expect(native.acquired).toEqual(['mic']);
    await audio.startSource('player');
    expect(native.acquired).toEqual(['mic', 'player']);
    expect(native.released).toEqual(['mic']);
    await audio.startSource('player');
    expect(native.acquired).toHaveLength(2);
    audio.stop();
    expect(native.released).toEqual(['mic', 'player']);
    expect(audio.source).toBe('off');
    expect(audio.uniforms.audioBPM).toBe(0);
  });

  it('forgets the tempo when the beats stop', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('mic');
    for (let t = 0; t < 4000; t += 1000 / 60) { native.frame = nativeFrame(t % 500 < 40 ? 230 : 40, 60); audio.update(t); }
    expect(audio.uniforms.audioBPM).toBeGreaterThan(0);
    for (let t = 4000; t < 9000; t += 1000 / 60) { native.frame = nativeFrame(40, 60); audio.update(t); }
    expect(audio.uniforms.audioBPM).toBe(0);
    expect(audio.uniforms.audioBeatPhase).toBe(0);
  });
});

describe('silky, smoothed response', () => {
  /** A kick drum at 120 BPM over a steady bed (or, `swell`, bass rising and falling smoothly), `seconds` long at `fps`. */
  async function play(fps: number, seconds = 6, swell = false) {
    const audio = new StandaloneAudio();
    await audio.startSource('player');
    const trace: { t: number; bass: number; mid: number; level: number; beat: number; flow: number }[] = [];
    for (let t = 0; t < seconds * 1000; t += 1000 / fps) {
      const kick = t % 500 < 60;
      native.frame = swell ? nativeFrame(Math.round(140 + 90 * Math.sin(t / 700)), 90) : nativeFrame(kick ? 235 : 70, kick ? 120 : 90);
      audio.update(t);
      const u = audio.uniforms;
      trace.push({ t, bass: u.audioBass, mid: u.audioMid, level: u.audioLevel, beat: u.audioBeat, flow: u.audioFlow ?? 0 });
    }
    return trace;
  }

  it('springs follow without jumping, kinking or overshooting, at any frame rate', () => {
    for (const fps of [30, 60, 120]) {
      const spring = new Spring(8);
      let last = 0, peak = 0;
      for (let t = 0; t < 2; t += 1 / fps) { last = spring.step(1, 1 / fps); peak = Math.max(peak, last); }
      expect(peak).toBeLessThanOrEqual(1 + 1e-12);
      expect(last).toBeGreaterThan(0.99);
    }
    // The exact solution: the same value at the same moment whatever the step.
    const at = (fps: number) => { const s = new Spring(8); for (let i = 0; i < fps / 4; i++) s.step(1, 1 / fps); return s.value; };
    expect(at(40)).toBeCloseTo(at(120), 10);
  });

  it('never jumps from one frame to the next', async () => {
    const trace = await play(60);
    let band = 0, beat = 0;
    for (let i = 1; i < trace.length; i++) {
      band = Math.max(band, ...(['bass', 'mid', 'level'] as const).map(k => Math.abs(trace[i][k] - trace[i - 1][k])));
      beat = Math.max(beat, Math.abs(trace[i].beat - trace[i - 1].beat));
    }
    // On this track the old bands jumped up to 0.72 in one frame and the beat by the full 1.0.
    expect(band).toBeLessThan(0.08);
    expect(beat).toBeLessThan(0.25);
  });

  it('swells into each beat over several frames and breathes out', async () => {
    const trace = await play(60);
    // The fourth beat (t = 1.5 s): it rises over more than three frames to near full, then fades.
    const start = trace.findIndex(p => p.t >= 1500);
    const window = trace.slice(start, start + 40);
    const peakAt = window.reduce((best, p, i) => (p.beat > window[best].beat ? i : best), 0);
    expect(window[peakAt].beat).toBeGreaterThan(0.85);
    expect(peakAt).toBeGreaterThanOrEqual(4);
    expect(window[peakAt + 18].beat).toBeLessThan(window[peakAt].beat * 0.7);
  });

  it('moves the same at 30, 60 and 120 frames a second', async () => {
    // A smooth swell: 60 ms kicks would be sampled differently by 30 fps frames, a test artefact.
    const [a, b, c] = await Promise.all([play(30, 6, true), play(60, 6, true), play(120, 6, true)]);
    const near = (trace: typeof a, t: number) => trace.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best));
    for (const t of [2000, 3250, 4700, 5900]) {
      for (const k of ['bass', 'level', 'flow'] as const) {
        expect(Math.abs(near(a, t)[k] - near(c, t)[k]), `${k} at ${t} ms`).toBeLessThan(0.08);
        expect(Math.abs(near(b, t)[k] - near(c, t)[k]), `${k} at ${t} ms`).toBeLessThan(0.05);
      }
    }
  });

  it('eases the spectrum shaders read, and marks itself live', async () => {
    const audio = new StandaloneAudio();
    await audio.startSource('mic');
    native.frame = nativeFrame(0, 0);
    audio.update(0);
    expect(SILENT_AUDIO.listening).toBeUndefined();
    expect(audio.uniforms.listening).toBe(true);
    native.frame = nativeFrame(255, 255);
    const rise: number[] = [];
    for (let t = 16; t < 200; t += 16) { audio.update(t); rise.push(audio.uniforms.spectrum![0]); }
    expect(rise[0]).toBeLessThan(255 * 0.5);
    expect(rise[rise.length - 1]).toBeGreaterThan(250);
  });
});
